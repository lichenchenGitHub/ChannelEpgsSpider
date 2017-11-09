/**
 * Created by lichenchen on 2016/11/2.
 */
var cluster = require("cluster");
var unirest = require('unirest');
var Promise = require("bluebird");
var kue = require("kue");
var redis = require("redis");
var url = require("url");
var jsdom = require("jsdom");
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
var closing = false;
var saveChannel = function (channelObj) {
    return new Promise(function (resolve, reject) {
        ChannelModel.Model.findOne({site: channelObj.site, schid: channelObj.schid}, function (err, channel) {
            if (err) {
                reject({code: 0, message: "Error : " + err});
            } else {
                if (!channel) {
                    ChannelModel.save(channelObj, function (err) {
                        if (err) {
                            reject({code: 0, message: "Error : " + err});
                        }
                        console.log(channelObj.name + " saved!")
                        resolve(true)
                    })
                }
                else if (channel.name != channelObj.name || channel.dname != channelObj.dname || channel.logo != channelObj.logo) {
                    channel.name = channelObj.name;
                    channel.dname = channelObj.dname;
                    channel.logo = channelObj.logo;
                    channel.utime = channelObj.utime;
                    channel.save(function (err) {
                        if (err) {
                            reject({code: 0, message: "Error : " + err});
                        } else {
                            console.log(channelObj.name + "saved!")
                            resolve(true)
                        }
                    });
                }
                else {
                    console.log(channelObj.name + " has exsist!");
                    resolve(true);
                }
            }
        })
    })
}
var saveChannelEpg = function (flag, channelEpgObj) {
    var newEpg = Hasher.GetMD5(channelEpgObj.epg.toString());
    return new Promise(function (resolve, reject) {
        if (flag) {
            ChannelEpgModel.Model.findOne({
                schid: channelEpgObj.schid,
                date: channelEpgObj.date
            }, function (err, channelEpg) {
                if (err) {
                    reject({code: 0, message: "Error : " + err});
                } else {
                    if (!channelEpg) {
                        ChannelEpgModel.save(channelEpgObj, function (err) {
                            if (err) {
                                reject({code: 0, message: "Error : " + err});
                            } else {
                                console.log(channelEpgObj.schid + " saved");
                                resolve(true);
                            }
                        })
                    } else {
                        var oldEpg = Hasher.GetMD5(channelEpg.epg.toString());
                        if (newEpg == oldEpg) {
                            console.log(channelEpgObj.schid + " exsist");
                            resolve(true);
                        } else {
                            channelEpg.epg = channelEpgObj.epg;
                            channelEpg.save(function (err) {
                                if (err) {
                                    reject({code: 0, message: "Error : " + err});
                                } else {
                                    console.log(channelEpgObj.schid + " update");
                                    resolve(true);
                                }
                            })
                        }
                    }
                }

            });
        } else {
            reject({code: 1, message: "Error : flag is false"});
        }
    });
}
var enterDatabase = function (array, id) {
    var channelObj = array[0];
    var channelEpgObj = array[1];
    var links = array[2];
    return new Promise(function (resolve, reject) {
        console.log("step2.1 : job " + id + " enter saveChannel");
        return saveChannel(channelObj).then(function (flag) {
            console.log("step2.2 : job " + id + " enter saveChannelEpg");
            return saveChannelEpg(flag, channelEpgObj);
        }).then(function (flag) {
            if (flag) {
                resolve(links);
            } else {
                reject({code: 1, message: "Error : saveChannelEpg"});
            }
        });
    });
}

var getChannelEpg = function (root) {
    return new Promise(function (resolve, reject) {
        var channelEpg = null;
        var date = null;
        var epg = [];
        console.log("root :" + root);
        jsdom.env({
            url: root,
            userAgent: "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/51.0.2704.106 Safari/537.36",
            features: {
                FetchExternalResources: ["script"/*, "frame", "iframe", "link", "img"*/],
                ProcessExternalResources: ["script"],
                MutationEvents: '2.0'
            },
            src: [jquery],
            done: function (err, window) {
                if (!window.$) {
                    reject({code: 0, message: "Error :" + root + " get dom err"});
                }
                var getLinks = function ($) {
                    var linkArray = [];
                    //var $ = window.$;
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
                var getChannel = function ($) {
                    //var $ = window.$;
                    var schid = null;
                    var name = null;
                    var dname = null;
                    var logo = null;
                    var result = null;
                    result = /(\w+):\/\/([^\:|\/]+)(\:\d*)?(.*\/)([^#|\?|\n]+)?(#.*)?(\?.*)?/i.exec(root)[5].split(".")[0].split("-");
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

                var getEpg = function () {
                    var $ = window.$;
                    var isNull = $("#pgrow > li> div");
                    if (isNull.length == 0) {
                        reject({code: 1, message: "Error : " + root + "该页面没有数据"});
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
                                reject("Invalid Date");
                            }
                        }

                    });
                    channelEpg = new ChannelEpg(rules.rules[0].site, "", date.getTime(), root);
                    epg.forEach(function (item, index, epg) {
                        channelEpg.addProgram(item.starttime, item.program);
                    });
                    var channel = getChannel($);
                    if (!channel) {
                        reject("Error : 频道信息获取出错");
                    }
                    var links = getLinks($);
                    if (links.length <= 0) {
                        reject({code: 1, message: "Error : " + root + "爬取连接失败"});
                    }
                    channelEpg.schid = channel.schid;
                    resolve([channel, channelEpg, links]);

                }
                setTimeout(getEpg, 1000);
            }
        });
    });
}
var pushQuue = function (links) {
    console.log("length = "+links.length+" start pushQueue at"+new Date());
    return Promise.map(links,
        function (link, index) {
            var hash = Hasher.GetSHA1('' + link);
            return new Promise(function (resolve, reject) {
                keystore.set(hash, 1, 'EX', expireDuration, 'NX', function (err, msg) {
                    if (err) {
                        reject({code: 1, message: "Error : keystore " + err});
                    } else if (msg == 'OK') {
                        queue.create('crawllingUrl', {
                            url: link,
                        }).attempts(3).backoff({
                            delay: 600000,
                            type: 'fixed'
                        }).removeOnComplete(true).save(function (err) {
                            if (err) {
                                reject({code: 1, message: "Error : pushQueue " + err})
                            } else {
                                resolve(index);
                            }
                        });
                    } else {
                        resolve("the keystore has exsists");
                    }
                })
            });
        }, {concurrency: 10}).then(function (data) {
    }).catch(function (err) {
        console.error(err);
    });
}
if (cluster.isMaster) {
    var forkWorker = function () {
        var worker = cluster.fork();
        worker.on('error', function (err) {
            console.log('worker error: ' + err);
        });
        console.log('worker ' + worker.process.pid + ' forked at: ' + new Date());
        return worker;
    };

    queue.on('error', function (err) {
        console.error(JSON.stringify({role: 'scheduler', err: err}));
    });
    pushQuue([baseUrl]).then(function(data){
        var workerCount = numCPUs;
        for (var i = 0; i < workerCount; i++) {
            forkWorker();
        }
    });
    var logStat = function () {
        queue.inactiveCount(function (err, total) {
            console.log('inactive: ' + total);
        });
    };
    var logInterval = null;
    logInterval = setInterval(logStat, 10000);
    cluster.on('exit', function (worker, code, signal) {
        if (signal) {
            console.log('worker ' + worker.process.pid + ' was killed by signal: ' + signal);
        }
        else if (code !== 0) {
            console.log('worker ' + worker.process.pid + ' exited with error code: ' + code);
            forkWorker();
        }
        else {
            console.log('worker ' + worker.process.pid + ' exited success!');
        }
    });

    var quitScheduler = function () {
        if (!closing) {
            closing = true;

            for (var id in cluster.workers) {
                console.log('Closing worker id: ' + id);
                cluster.workers[id].kill('SIGTERM');
            }

            //mongoose.connection.close();

            setTimeout(function () {
                process.exit(0);
            }, 10000);
        }
    };

    process.once("SIGINT", quitScheduler);
    process.once("SIGTERM", quitScheduler);


} else {
    var reportInterval = null;

    var quitWorker = function () {
        if (!closing) {
            closing = true;

            console.log('worker shutting down...');
            if (reportInterval) {
                clearInterval(reportInterval);
                reportInterval = null;
            }
            mongoose.connection.close();
            process.exit(0);
        }
    };

    process.on('message', function (msg) {
        if (msg == 'shutdown') {
            quitWorker();
        }
    });

    process.once("SIGINT", quitWorker);
    process.once("SIGTERM", quitWorker);
    queue.process("crawllingUrl", function (job, done) {
        console.log("job " + job.id + " : start at " + new Date());
        console.log("step1 : job " + job.id + " : enter  getChannelEpg");
        return getChannelEpg(job.data.url).then(function (data) {
            console.log("step2 : job " + job.id + " enter enterDatabase");
            return enterDatabase(data, job.id);
        }).then(function (links) {
            console.log("step3 : job " + job.id + " enter pushQuue");
            return pushQuue(links);
        }).nodeify(done);
        //Promise.method(function() {
        //        getChannelEpg(job.data.url).then(function (data) {
        //            console.log("step2 : job " + job.id + " enter enterDatabase");
        //            return enterDatabase(data, job.id);
        //        }).then(function (links) {
        //            console.log("step3 : job " + job.id + " enter pushQuue");
        //            return pushQuue(links);
        //        })
        //    }
        //)().nodeify(done);
        //getChannelEpg(job.data.url).then(function (data) {
        //    console.log("step2 : job " + job.id + " enter enterDatabase");
        //    return enterDatabase(data, job.id);
        //}).then(function (links) {
        //    console.log("step3 : job " + job.id + " enter pushQuue");
        //    return pushQuue(links);
        //}).then(function (array) {
        //    console.log("job " + job.id + " : complete at " + new Date());
        //    return done();
        //}).catch(function (err) {
        //    console.error(err);
        //    if(err.code && parseInt(err.code)==0) {
        //       return done(new Error("job " + job.id + " : process Error"));
        //    }else{
        //       return done();
        //    }
        //})
    })

}
