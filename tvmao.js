/**
 * Created by lichenchen on 2016/11/14.
 */
var cluster = require("cluster");
var unirest = require('unirest');
var Promise = require("bluebird");
var kue = require("kue");
var redis = require("redis");
var url = require("url");
var jsdom = require("jsdom");
var async=require("async");
var window = jsdom.jsdom().defaultView;
var fs = require("fs");
var jquery = fs.readFileSync('./public/javascripts/jquery-1.11.3.min.js').toString();
var numCPUs = require('os').cpus().length;

var conf = require('./conf/config');
var rules = require("./conf/rules");
var mongoose = require('./lib/mongoose');
var Channel = require('./model/tv/channel');
var ChannelEpg = require('./model/tv/channelepg');

var ChannelModel = Channel.getMongoDataModel(mongoose);
var ChannelEpgModel = ChannelEpg.getMongoDataModel(mongoose);
var keystore = redis.createClient(conf.redisConf.keys.port, conf.redisConf.keys.host);
var expireDuration = 1000 * 60 * 60 * 3;
var Hasher = require('./lib/hasher');
var poolOption = {
    maxSockets: 100
};
var queue = kue.createQueue({
    prefix: conf.name,
    redis: conf.redisConf.queue,
});
var baseUrl = rules.rules[0].baseUrl;
var urlInfo = url.parse(baseUrl);
var start = "/^" + urlInfo.protocol + "\\/\\/" + urlInfo.host + "*$/";

if (cluster.isMaster) {
    queue.on('error', function (err) {
        console.error(JSON.stringify({role: 'scheduler', err: err}));
    });
    var logStat = function () {
        queue.inactiveCount(function (err, total) {
            console.log('inactive: ' + total);
        });
    };
    var hash = Hasher.GetSHA1(baseUrl);
    keystore.set(hash, 1, 'EX', expireDuration, 'NX', function (err, msg) {
        if (err) {
            console.log(JSON.stringify({role: "init", err: err}));
        } else if (msg == 'OK') {
            var job = queue.create("links", {url: baseUrl, level: 0}).attempts(3).backoff({
                delay: 60 * 1000,
                type: 'fixed'
            }).removeOnComplete(true).save(function (err) {
                if (err) {
                    console.log(baseUrl + " : create job err " + err);
                } else {
                    console.log(baseUrl + " : create job success as job " + job.id);
                }
            })
        } else {
            console.log(baseUrl + " has in jobList");
        }

    });

    var logInterval = null;
    logInterval = setInterval(logStat, 10000);
    for (var i = 0; i < numCPUs; i++) {
        cluster.fork();
    }
    cluster.on('exit', function (worker, code, signal) {
        console.log('worker ' + worker.process.pid + ' died');
    });
    var quitCallback = function () {
        queue.shutdown(1000, function (err) {
            for (var id in cluster.workers) {
                console.log('Closing worker id: ' + id);
                cluster.workers[id].kill('SIGTERM');
            }
            setTimeout(function () {
                process.exit(0);
            }, 3000);
        });
    }
} else {
    queue.process("links", function (job, done) {
        if (job.data.level <= 3) {
            async.waterfall([async.apply(getPageInfo, job.data.url, job.data.level),pushQueue],function(err){
                if(err)
                {
                    done(err)
                }else{
                    done();
                }
            });
        } else {
            console.log("job " + job.id + " done error")
            done(JSON.stringify({role: "job done ", err: "level limit"}));
        }

    });
    queue.process("channel", function (job, done) {
        async.waterfall([async.apply(saveChannel, job.data.channel)], function (err) {
            if (err) {
                console.log("channel job :" + job.id + err);
                done(err);
            } else {
                console.log("channel job :" + job.id + " is done");
                done();
            }
        })
    });
    queue.process("channelEpg", function (job, done) {
        async.waterfall([async.apply(saveChannelEpg, job.data.channelEpg)], function (err) {
            if (err) {
                console.log("channelEpg job :" + job.id + err);
                done(err);
            } else {
                console.log("channelEpg job :" + job.id + " is done");
                done();
            }
        });

    });
}


var pushQueue = function (channel, channelEpg, links, level, cb) {
    var createChannelJob = function (channel, callback) {
        var job = queue.create("channel", {channel: channel}).attempts(3).backoff({
            delay: 60 * 1000,
            type: 'fixed'
        }).removeOnComplete(true).save(function (err) {
            if (err) {
                console.log(channel.name + " : create channelJob err " + err);
                callback(JSON.stringify({role: 'channelJob', err: err}))
            } else {
                console.log(channel.name + " : create channelJob success as job " + job.id);
                callback(null);
            }
        })
    }
    var createChannelEpgJob = function (channelEpg, callback) {
        var job = queue.create("channelEpg", {channelEpg: channelEpg}).attempts(3).backoff({
            delay: 60 * 1000,
            type: 'fixed'
        }).removeOnComplete(true).save(function (err) {
            if (err) {
                console.log(channelEpg.schid + " : create channelEpgJob err " + err);
                callback(JSON.stringify({role: 'channelEpgJob', err: err}))
            } else {
                console.log(channel.schid + " : create channelEpgJob success as job " + job.id);
                callback(null);
            }
        })
    }
    var createLinkJobs = function (links, level, callback) {
        var iterator = function (link, cb) {
            var hash = Hasher.GetSHA1(link);
            keystore.set(hash, 1, 'EX', expireDuration, 'NX', function (err, msg) {
                if (err) {
                    cb(JSON.stringify({role: 'checkRedis', err: err}));
                } else if (msg == 'OK') {
                    var job = queue.create("links", {url: link, level: level + 1}).delay(1000).attempts(3).backoff({
                        delay: 60 * 1000,
                        type: 'fixed'
                    }).removeOnComplete(true).save(function (err) {
                        if (err) {
                            console.log(link + " : create linksJob err " + err);
                            cb(JSON.stringify({role: 'linksJob', err: err}))

                        } else {
                            console.log(baseUrl + " : create linksJob success as job " + job.id);
                            cb(null);
                        }
                    })

                } else {
                    //console.log(links +" has in jobList")
                    cb(null);
                }
            });

        }
        async.eachSeries(links, iterator, callback);
    }
    async.series([async.apply(createChannelJob, channel), async.apply(createChannelEpgJob, channelEpg), async.apply(createLinkJobs, links, level)], function (err) {
        if (err) {
            cb(JSON.stringify({role: "pushQueue", err: err}))
        } else {
            cb(null)
        }
    });
}
var getPageInfo = function (url, level, cb) {
    var channelEpg = null;
    var date = null;
    var epg = [];
    jsdom.env({
        url: url,
        userAgent: "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/51.0.2704.106 Safari/537.36",
        features: {
            FetchExternalResources: ["script"/*, "frame", "iframe", "link", "img"*/],
            ProcessExternalResources: ["script"],
            MutationEvents: '2.0'
        },
        src: [jquery],
        done: function (err, window) {
            if (!window.$) {
                cb(JSON.stringify({role: "getPageInfo ", err: "get dom error"}))
            } else {
                var getEpg = function () {
                    var $ = window.$;
                    var isNull = $("#pgrow > li> div");
                    if (!isNull || isNull.length == 0) {
                        cb(JSON.stringify({role: "getPageInfo ", err: "page no data"}));
                    }
                    var night = $('#night');
                    if (night.length == 0) {

                        return setTimeout(getEpg, 1000);
                    }
                    var epgList = $("#pgrow > li");
                    var monthDay = $("body > div.epghdc > dl > dd.weekcur > span").text();
                    monthDay = monthDay.split("-");
                    epgList.each(function () {
                        if (!$(this).attr("id") && !date) {
                            var timeString = $(this).find("div.over_hide > span.p_show >a").attr("res");
                            if (timeString) {
                                var date1 = timeString.split('_')[0];
                                var date2 = date1.split("-")[0];
                                date = new Date(date2);
                            }
                        }
                    });
                    if (!date) {
                        date = new Date();
                    }
                    date.setMonth(parseInt(monthDay[0] - 1), parseInt(monthDay[1]));
                    epgList.each(function () {
                        if (!$(this).attr("id")) {
                            var time = $(this).find("div.over_hide > span:nth-child(1)").text();
                            time = time.split(":");
                            var program = $(this).find("div.over_hide > span.p_show").text();
                            var starttime = date;
                            starttime.setHours(parseInt(time[0]) + 8, time[1]);
                            if (starttime != 'Invalid Date' && program) {
                                epg.push({starttime: starttime.getTime(), program: program});
                            } else {
                                cb(JSON.stringify({role: "getPageInfo ", err: "Invalid Date"}))
                            }
                        }

                    });
                    channelEpg = new ChannelEpg(rules.rules[0].site, "", date.getTime(), url);
                    epg.forEach(function (item, index, epg) {
                        channelEpg.addProgram(item.starttime, item.program);
                    });
                    var channel = getChannel($,url);
                    if (!channel) {
                        cb(JSON.stringify({role: "getPageInfo ", err: "channel info error"}))
                    }
                    var links = getLinks($);
                    if (links.length <= 0) {
                        cb(JSON.stringify({role: "getPageInfo ", err: "crawlling connection error"}))
                    }
                    channelEpg.schid = channel.schid;
                    cb(null, channel, channelEpg, links, level);

                }
                setTimeout(getEpg, 1000);

            }
        }
    })
}
var getLinks = function ($) {
    var linkArray = [];
    var links = $("a");
    links.each(function () {
        var href = $(this).attr("href");
        var expr = new RegExp(rules.rules[0].pattern);
        if (expr.exec(href)) {
            linkArray.push(href);
        } else {
            var expr2 = new RegExp(start);
            if (!expr2.exec(href)) {
                if (typeof(href) == "string") {
                    var prefix = urlInfo.protocol + "\/\/" + urlInfo.host;
                    href = url.resolve(urlInfo.protocol + "//" + urlInfo.host, href);
                    if (expr.exec(href)) {
                        linkArray.push(href);
                    }
                }
            }
        }

    })
    return linkArray;
}
var getChannel = function ($,url) {
    var schid = null;
    var name = null;
    var dname = null;
    var logo = null;
    var result = null;
    result = /(\w+):\/\/([^\:|\/]+)(\:\d*)?(.*\/)([^#|\?|\n]+)?(#.*)?(\?.*)?/i.exec(url)[5].split(".")[0].split("-");
    if (result) {
        if (result.length >= 4) {
            name = result[1];
            for (var i = 2; i < result.length - 1; i++) {
                name += "-" + result[i];
            }
        } else {
            name = result[1];
        }
        schid = result[0] + '-' + name;
    }
    var img = $('div.pgmain > div.clear > h1>img');
    if (img.length > 0) {
        dname = img.attr('alt');
        logo = img.attr('src');
    }
    console.log(schid + "--" + name + "--" + dname + "--" + logo);
    if (schid && name && dname && logo) {
        channel = new Channel(rules.rules[0].site, schid, name, dname, logo);
        return channel;
    }
    else {
        return null;
    }
}
var saveChannel = function (channelObj, cb) {
    ChannelModel.Model.findOne({site: channelObj.site, schid: channelObj.schid}, function (err, channel) {
        if (err) {
            cb(JSON.stringify({role: "findChannel", err: err}));
        } else {
            if (!channel) {
                ChannelModel.save(channelObj, function (err) {
                    if (err) {
                        cb(JSON.stringify({role: "saveChannel", err: err}));
                    }
                    console.log(channelObj.name + " saved!")
                    cb(null);
                })
            }
            else if (channel.name != channelObj.name || channel.dname != channelObj.dname || channel.logo != channelObj.logo) {
                channel.name = channelObj.name;
                channel.dname = channelObj.dname;
                channel.logo = channelObj.logo;
                channel.utime = channelObj.utime;
                channel.save(function (err) {
                    if (err) {
                        cb(JSON.stringify({role: "saveChannel", err: err}));
                    } else {
                        console.log(channelObj.name + "saved!")
                        cb(null);
                    }
                });
            }
            else {
                console.log(channelObj.name + " has exsist!");
                cb(null);
            }
        }
    })
}
var saveChannelEpg = function (channelEpgObj, cb) {
    var newEpg = Hasher.GetMD5(channelEpgObj.epg.join(""));
    ChannelEpgModel.Model.findOne({
        schid: channelEpgObj.schid,
        date: channelEpgObj.date
    }, function (err, channelEpg) {
        if (err) {
            cb(JSON.stringify({role: "findChannelEpg", err: err}));
        } else {
            if (!channelEpg) {
                ChannelEpgModel.save(channelEpgObj, function (err) {
                    if (err) {
                        cb(JSON.stringify({role: "saveChannelEpg", err: err}));
                    } else {
                        console.log(channelEpgObj.schid + " saved");
                        cb(null);
                    }
                })
            } else {
                var oldEpg = Hasher.GetMD5(channelEpg.epg.join(""));
                if (newEpg == oldEpg) {
                    console.log(channelEpgObj.schid + " exsist");
                    cb(null);
                } else {
                    channelEpg.epg = channelEpgObj.epg;
                    channelEpg.save(function (err) {
                        if (err) {
                            cb(JSON.stringify({role: "saveChannelEpg", err: err}))
                        } else {
                            console.log(channelEpgObj.schid + " update");
                            cb(null);
                        }
                    })
                }
            }
        }

    });

}