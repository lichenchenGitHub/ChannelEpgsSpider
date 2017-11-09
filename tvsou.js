/**
 * Created by lichenchen on 2016/11/11.
 */
var cluster = require("cluster");
var unirest = require('unirest');
var Promise = require("bluebird");
var kue = require("kue");
var redis = require("redis");
var url = require("url");
var jsdom = require("jsdom");
var fs = require("fs");
var jquery = fs.readFileSync('./public/javascripts/jquery-1.11.3.min.js').toString();
var numCPUs = require('os').cpus().length;
var async = require("async");

var conf = require('./conf/config');
var rules = require("./conf/rules");
var mongoose = require('./lib/mongoose');
var Channel = require('./model/tv/channel');
var ChannelEpg = require('./model/tv/channelepg');

var ChannelModel = Channel.getMongoDataModel(mongoose);
var ChannelEpgModel = ChannelEpg.getMongoDataModel(mongoose);
var keystore = redis.createClient(conf.redisConf.keys.port, conf.redisConf.keys.host);
var expireDuration = 1000 * 60 * 4;
var Hasher = require('./lib/hasher');
var poolOption = {
    maxSockets: 100
};
var queue = kue.createQueue({
    prefix: conf.name,
    redis: conf.redisConf.queue,
});
var baseUrl = rules.rules[1].baseUrl;
var urlInfo = url.parse(baseUrl);
var start = "/^" + urlInfo.protocol + "\\/\\/" + urlInfo.host + "*$/";
//var expr = new RegExp(rules.rules[1].pattern);
//console.log(expr.exec("http://www.tvsou.com/epg/cctv5-asc+def?class=yangshi"));
var initJobs=function(){
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
        }else{
            console.log(baseUrl+" has in jobList");
        }

    });

}
if (cluster.isMaster) {
    queue.on('error', function (err) {
        console.error(JSON.stringify({role: 'scheduler', err: err}));
    });
    var logStat = function () {
        queue.inactiveCount(function (err, total) {
            console.log('inactive: ' + total);
        });
    };
    initJobs();
    var resetInterval = null;
    resetInterval = setInterval(initJobs, 1000 * 60 * 5);
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
            if (resetInterval) {
                clearInterval(resetInterval);
                resetInterval = null;
            }
            if (logInterval) {
                clearInterval(logInterval);
                logInterval = null;
            }

            for (var id in cluster.workers) {
                console.log('Closing worker id: ' + id);
                cluster.workers[id].kill('SIGTERM');
            }
            setTimeout(function () {
                process.exit(0);
            }, 3000);
        });
    }
    process.once("SIGINT", quitCallback );
    process.once("SIGTERM", quitCallback );
} else {
    queue.process("links", function (job, done) {
        if (job.data.level <= 2) {
            async.waterfall([async.apply(getHtml, job.data.url, job.data.level), getPageInfo, pushQueue], function (err) {
                if (err) {
                    done(err);
                } else {
                    console.log("job : " + job.id + " is done,level:" + job.data.level);
                    done();
                }
            })
        } else {
            console.log(job.id + " is failed,level:" + job.data.level);
            done("level access forbidden");
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
var getHtml = function (link, level, cb) {
    var req = unirest.get(link);
    req.pool(poolOption);
    req.headers(rules.headers);
    req.end(function (res) {
        if (res.status != 200) {
            cb(JSON.stringify({role: "unirest", err: link + ":statusCode:" + res.statusCode}));
        } else {
            cb(null, res.body, link, level);
        }
    })

}
var getPageInfo = function (data, url, level, cb) {
    jsdom.env({
        html: data,
        src: [jquery],
        done: function (err, window) {
            if (err) {
                cb(JSON.stringify({role: 'jsdom', err: url + " " + err}));
            }
            else {
                if (window.$) {
                    var $ = window.$;
                    var links = getLinks($);
                    var channel = getChannel($);
                    var channelEpg = getChannelEpg($);
                    channelEpg.schid = channel.schid;
                    if (links.length > 0 && channel) {
                        window.close();
                        cb(null, channel, channelEpg, links, level);
                    } else {
                        window.close();
                        cb(JSON.stringify({role: 'jsdom', err: url + "get pageInfo error"}))
                    }

                } else {
                    window.close();
                    cb(JSON.stringify({role: 'jsdom', err: url + " " + err}));
                }


            }
        }
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
                            console.log(baseUrl + " : create linksJob err " + err);
                            cb(JSON.stringify({role: 'linksJob', err: err}))

                        } else {
                            console.log(baseUrl + " : create linksJob success as job " + job.id);
                            cb(null);
                        }
                    })

                }else{
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
            cb(null);
        }
    });
}
var getLinks = function ($) {
    var linkArray = [];
    var links = $("a");
    links.each(function () {
        var href = $(this).attr("href");
        if (typeof(href) == "string") {
            var expr = new RegExp(rules.rules[1].pattern);
            if (expr.exec(href)) {
                linkArray.push(href);
            } else {
                var expr2 = new RegExp(start);
                if (!expr2.exec(href)) {
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
var getChannel = function ($) {
    var channel = {};
    var schid = null;
    var name = null;
    var dname = null;
    var logo = null;
    var channelInfo = $("body > div.details-box.mr > div.l.details-box-l.index-details-box-l.st-tab > div.tv-table.program-tab > div.sidebar > div.channel-box.channel-boxs.cd-l-list> ul > li.active > a");
    var result = channelInfo.attr("href").split("?");
    name = result[0].split("/")[2];
    schid = result[1].split("=")[1] + "-" + name;
    dname = channelInfo.attr("title");
    var img = channelInfo.find("img");
    if (img.length > 0) {
        logo = img.attr('src');
    }
    console.log(schid + "--" + name + "--" + dname + "--" + logo);
    if (schid && name && dname && logo) {
        channel = new Channel(rules.rules[1].site, schid, name, dname, logo);
        return channel;
    }
    else {
        return null;
    }
}
var getChannelEpg = function ($, url) {
    var channelEpg = null;
    var date = null;
    var epg = [];
    var dateInfo = $("body > div.details-box.mr > div.l.details-box-l.index-details-box-l.st-tab > div.tv-table.program-tab > div.rightbox.r.tit-top.table-list > div.epgbox > div:nth-child(1) >a.font-14.color-02.aw.text-c.week");
    var pattern = /(\d{4})(\d{2})(\d{2})/;
    date = new Date(dateInfo.attr("href").split("?")[0].split("/")[3].replace(pattern, '$1-$2-$3'));
    var epgList = $("body > div.details-box.mr > div.l.details-box-l.index-details-box-l.st-tab > div.tv-table.program-tab > div.rightbox.r.tit-top.table-list > div.play-time-more > ol > li");
    epgList.each(function () {
        var timeArray = $(this).find("span").text().split(":");
        var starttime = date;
        starttime.setHours(parseInt(timeArray[0]) + 8, timeArray[1]);
        var program = $(this).find("a").text();
        if (starttime != 'Invalid Date' && program) {
            epg.push({starttime: starttime.getTime(), program: program});
        } else {
            cb(JSON.stringify({role: 'EpgItem', err: url + "get pageInfo error"}));
        }
    });
    channelEpg = new ChannelEpg(rules.rules[1].site, "", date.getTime(), url);
    epg.forEach(function (item, index, epg) {
        channelEpg.addProgram(item.starttime, item.program);
    });
    return channelEpg;
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
