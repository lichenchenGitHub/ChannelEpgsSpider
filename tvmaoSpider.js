/**
 * Created by lichenchen on 2016/11/15.
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
var expireDuration = 1000 * 60 * 60 * 12;
var Hasher = require('./lib/hasher');
var rule = require("./conf/rules");
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
var initJobs = function () {
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
    resetInterval = setInterval(initJobs, 1000 * 60 * 60 * 12);

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
    process.once("SIGINT", quitCallback);
    process.once("SIGTERM", quitCallback);
} else {
    queue.process("links", function (job, done) {
        getPageInfo(job.data.url, job.data.level).then(function (array) {
            return enterDatabase(array);
        }).then(function (data) {
            return pushQuue(data);
        }).then(function (data) {
            done();
        }).catch(function (err) {
            done(err);
        });


    })

}
var getPageInfo = function (root, level) {
    return new Promise(function (resolve, reject) {
        var channelEpg = null;
        var date = null;
        var epg = [];
        console.log("ready to get " + root + " pageData at " + new Date());
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
                if (err) {
                    reject({code: -1, message: "get window error"});
                }
                console.log("get " + root + " pageData success at " + new Date());
                if (window.A) {
                    var $ = window.$;
                    var isNull = $("#pgrow > li> div");
                    if (!isNull || isNull.length == 0) {
                        window.close();
                        reject({code: -1, message: "Error : " + root + "该页面没有数据"});
                    }else {
                        var epgList = $("#pgrow > li");
                        var monthDay = $("body > div.epghdc > dl > dd.weekcur > span").text();
                        monthDay = monthDay.split("-");
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
                        var getChannel = function ($) {
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
                        var links = getLinks($);
                        var channel = getChannel($);
                        if (links.length <= 0 || !channel) {
                            window.close();
                            reject({code: -1, message: "获取连接或者频道信息出错"})
                        }
                        var b = "src";
                        var d = window.A.d("a", b);
                        window.close();
                        console.log("ready get " + root + " api's data");
                        var req = unirest.get("http://www.tvmao.com/api/pg?p=" + d);
                        req.pool(poolOption);
                        req.headers(rule.rules[0].headers);
                        req.end(function (res) {
                            if (res.status == 200) {
                                console.log("get " + root + " api's data success at " + new Date());
                                var data = JSON.parse(res.body);
                                if (data[0] == 1) {
                                    jsdom.env({
                                        html: data[1],
                                        src: [jquery],
                                        done: function (err, window) {
                                            if (err) {
                                                reject({code: -1, message: "get api's window error"})
                                            }
                                            console.log("ready parse " + root + " api's data " + new Date());
                                            var $ = window.$;
                                            var list = $("li");
                                            list.each(function () {
                                                epgList.push(this);
                                            })
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
                                                        window.close();
                                                        reject({code: -1, message: "Invalid Date"});
                                                    }
                                                }

                                            });
                                            window.close();
                                            channelEpg = new ChannelEpg(rules.rules[0].site, "", date.getTime(), root);
                                            epg.forEach(function (item, index, epg) {
                                                channelEpg.addProgram(item.starttime, item.program);
                                            });
                                            channelEpg.schid = channel.schid;
                                            console.log("parse " + root + " api's data success");
                                            resolve([channel, channelEpg, links, level]);
                                        }
                                    })
                                } else {
                                    window.close();
                                    reject({code: -1, message: "api's data get Error"})
                                }

                            } else {
                                window.close();
                                reject({code: -1, message: "获取午间信息失败"});

                            }
                        });
                    }
                } else {
                    window.close();
                    reject({code: -1, message: "get window A Error"});
                }
            }
        });
    })
}
var pushQuue = function (array) {
    var links = array[0];
    var level = array[1];
    console.log("length = " + links.length + " start pushQueue at" + new Date());
    return Promise.map(links,
        function (link, index) {
            var hash = Hasher.GetSHA1('' + link);
            return new Promise(function (resolve, reject) {
                keystore.set(hash, 1, 'EX', expireDuration, 'NX', function (err, msg) {
                    if (err) {
                        reject({code: 1, message: "Error : keystore " + err});
                    } else if (msg == 'OK') {
                        queue.create('links', {
                            url: link,
                            level: level + 1
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
var enterDatabase = function (array) {
    var channelObj = array[0];
    var channelEpgObj = array[1];
    var links = array[2];
    var level = array[3];
    return new Promise(function (resolve, reject) {
        console.log("channel " + channelObj.schid + " ready to enterDatabase at" + new Date());
        return saveChannel(channelObj).then(function (flag) {
            console.log("channelEpg " + channelEpgObj.schid + " ready to enterDataBase at" + new Date());
            return saveChannelEpg(flag, channelEpgObj);
        }).then(function (flag) {
            if (flag) {
                resolve([links, level]);
            } else {
                reject({code: 1, message: "Error : saveChannelEpg"});
            }
        });
    });
}
var saveChannel = function (channelObj) {
    return new Promise(function (resolve, reject) {
        ChannelModel.Model.findOne({site: channelObj.site, schid: channelObj.schid}, function (err, channel) {
            if (err) {
                reject({code: 1, message: "Error : " + err});
            } else {
                if (!channel) {
                    ChannelModel.save(channelObj, function (err) {
                        if (err) {
                            reject({code: 1, message: "Error : " + err});
                        }
                        console.log(channelObj.name + " saved at " + new Date());
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
                            reject({code: 1, message: "Error : " + err});
                        } else {
                            console.log(channelObj.name + "saved at" + new Date());
                            resolve(true)
                        }
                    });
                }
                else {
                    console.log(channelObj.name + " has exsist at" + new Date());
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
                    console.log("find channelEpg Error");
                    reject({code: 1, message: "Error : " + err});
                } else {
                    if (!channelEpg) {
                        ChannelEpgModel.save(channelEpgObj, function (err) {
                            if (err) {
                                console.log("save channelEpg Error");
                                reject({code: 1, message: "Error : " + err});
                            } else {
                                console.log(channelEpgObj.schid + " saved at" + new Date());
                                resolve(true);
                            }
                        })
                    } else {
                        var oldEpg = Hasher.GetMD5(channelEpg.epg.toString());
                        if (newEpg == oldEpg) {
                            console.log(channelEpgObj.schid + " exsist at" + new Date());
                            resolve(true);
                        } else {
                            channelEpg.epg = channelEpgObj.epg;
                            channelEpg.save(function (err) {
                                if (err) {
                                    console.log("updatechannelEpg Error");
                                    reject({code: 1, message: "Error : " + err});
                                } else {
                                    console.log(channelEpgObj.schid + " update at" + new Date());
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
