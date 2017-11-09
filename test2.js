/**
 * Created by lichenchen on 2016/11/10.
 */
var url = require("url");
var cluster = require("cluster");
var async = require("async");
var kue = require("kue");
var jsdom = require("jsdom");
var redis = require("redis");
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

queue = kue.createQueue({
    prefix: conf.name,
    redis: conf.redisConf.queue,
});
var baseUrl = rules.rules[0].baseUrl;
var urlInfo = url.parse(baseUrl);
var start = "/^" + urlInfo.protocol + "\\/\\/" + urlInfo.host + "*$/";

var expireDuration = 60 * 60 * 1000;

var createJob = function (links, createCallback) {
    var iterator = function (link, callback) {
        var hash = Hasher.GetSHA1(link);
        keystore.set(hash, 1, 'EX', expireDuration, 'NX', function (err, msg) {
            if (err) {
                console.error(err);
            }
            else if (msg == 'OK') {
                var job = queue.create('crawllingUrl', {url: link}).delay(1000).attempts(3).backoff( {delay: 60*1000, type:'fixed'}).removeOnComplete(true).save(function (err) {
                    if (err) {
                        console.log("url : " + link + " save Error");
                        callback(err);
                    } else {
                        console.log("url : " + link + " create sucess，job id is" + job.id);
                        callback(null, job.id);
                    }
                });
            }
            else {
                // job key exists
                console.log("url " + link + " has existed");
                callback(null);
            }
        });

    }
    async.eachSeries(links, iterator, createCallback);

}
var Callback = function (err) {
    if (err) {
        console.log(err)
    } else {
        console.log("job init at  " + new Date());
    }
}
var getChannel = function ($, url) {
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
var getPage = function (url, cb) {
    var channelEpg = null;
    var date = null;
    var epg = [];
    console.log("url : " + url + " is stating");
    jsdom.env({
        url: url,
        userAgent: "YisouSpider",
        src: [jquery],
        done: function (err, window) {
            if (err) {
                cb(err);
            } else if (window.$) {
                console.log("request is done");
                var $=window.$;
                var links=getLinks($);
                var channel=getChannel($,url);
                if(links.length>0 && channel){
                    cb(null,links,channel);
                }else{
                    cb("get pageIngo Error");
                }
            } else {
                cb("Error:dom 获取失败");
            }
        }
    });
}
var saveChannel = function (links, channelObj, cb) {
    ChannelModel.Model.findOne({site: channelObj.site, schid: channelObj.schid}, function (err, channel) {
        if (err) {
            cb({code: 0, message: "Error : " + err});
        } else {
            if (!channel) {
                ChannelModel.save(channelObj, function (err) {
                    if (err) {
                        cb({code: 0, message: "Error : " + err});
                    }
                    console.log(channelObj.name + " saved!")
                    cb(null, links)
                })
            }
            else if (channel.name != channelObj.name || channel.dname != channelObj.dname || channel.logo != channelObj.logo) {
                channel.name = channelObj.name;
                channel.dname = channelObj.dname;
                channel.logo = channelObj.logo;
                channel.utime = channelObj.utime;
                channel.save(function (err) {
                    if (err) {
                        cb({code: 0, message: "Error : " + err});
                    } else {
                        console.log(channelObj.name + "saved!")
                        cb(null, links)
                    }
                });
            }
            else {
                console.log(channelObj.name + " has exsist!");
                cb(null, links);
            }
        }
    })
}
var saveChannelEpg = function (links, channelEpgObj, cb) {
    var newEpg = Hasher.GetMD5(channelEpgObj.epg.join(""));
    ChannelEpgModel.Model.findOne({
        schid: channelEpgObj.schid,
        date: channelEpgObj.date
    }, function (err, channelEpg) {
        if (err) {
            cb({code: 0, message: "Error : " + err});
        } else {
            if (!channelEpg) {
                ChannelEpgModel.save(channelEpgObj, function (err) {
                    if (err) {
                        cb({code: 0, message: "Error : " + err});
                    } else {
                        console.log(channelEpgObj.schid + " saved");
                        cb(null, links);
                    }
                })
            } else {
                var oldEpg = Hasher.GetMD5(channelEpg.epg.join(""));
                if (newEpg == oldEpg) {
                    console.log(channelEpgObj.schid + " exsist");
                    cb(null, links);
                } else {
                    channelEpg.epg = channelEpgObj.epg;
                    channelEpg.save(function (err) {
                        if (err) {
                            cb({code: 0, message: "Error : " + err});
                        } else {
                            console.log(channelEpgObj.schid + " update");
                            cb(null, links);
                        }
                    })
                }
            }
        }

    });
}
if (cluster.isMaster) {
    queue.on('error', function (err) {
        console.error(JSON.stringify({role: 'scheduler', err: err}));
    });
    createJob([baseUrl], Callback);
    var logStat = function () {
        queue.inactiveCount(function (err, total) {
            console.log('inactive: ' + total);
        });
    };
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
    queue.process("crawllingUrl", function (job, done) {
        console.log(job.id + ": is doing");
        var jobCallback = function (err, result) {
            if (err) {
                console.log(job.id + ": is failed");
                console.log(err);
                done(err);
            } else {
                console.log(job.id + ": is completed");
                done();
            }
        }
        async.waterfall([async.apply(getPage, job.data.url), saveChannel,createJob], jobCallback);
    })
}