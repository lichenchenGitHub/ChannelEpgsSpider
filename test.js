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

// queue = kue.createQueue({
//     prefix: conf.name,
//     redis: conf.redisConf.queue,
// });
// var baseUrl = rules.rules[0].baseUrl;
// var urlInfo = url.parse(baseUrl);
// var start = "/^" + urlInfo.protocol + "\\/\\/" + urlInfo.host + "*$/";
//
// var expireDuration = 60 * 60 * 1000;

// var createJob = function (links, createCallback) {
//     var iterator = function (link, callback) {
//         var hash = Hasher.GetSHA1(link);
//         keystore.set(hash, 1, 'EX', expireDuration, 'NX', function (err, msg) {
//             if (err) {
//                 console.error(err);
//             }
//             else if (msg == 'OK') {
//                 var job = queue.create('crawllingUrl', {url: link}).attempts(3).removeOnComplete(true).save(function (err) {
//                     if (err) {
//                         console.log("url : " + link + " save Error");
//                         callback(err);
//                     } else {
//                         console.log("url : " + link + " create sucess，job id is" + job.id);
//                         callback(null, job.id);
//                     }
//                 });
//             }
//             else {
//                 // job key exists
//                 console.log("url " + link + " has existed");
//                 callback(null);
//             }
//         });
//
//     }
//     async.eachSeries(links, iterator, createCallback);
//
// }
// var Callback = function (err) {
//     if (err) {
//         console.log(err)
//     } else {
//         console.log("job init at  " + new Date());
//     }
// }
// var getChannel = function ($, url) {
//     var schid = null;
//     var name = null;
//     var dname = null;
//     var logo = null;
//     var result = null;
//     result = /(\w+):\/\/([^\:|\/]+)(\:\d*)?(.*\/)([^#|\?|\n]+)?(#.*)?(\?.*)?/i.exec(url)[5].split(".")[0].split("-");
//     if (result) {
//         if (result.length >= 4) {
//             name = result[1];
//             for (var i = 2; i < result.length - 1; i++) {
//                 name += "-" + result[i];
//             }
//         } else {
//             name = result[1];
//         }
//         schid = result[0] + '-' + name;
//     }
//     var img = $('div.pgmain > div.clear > h1>img');
//     if (img.length > 0) {
//         dname = img.attr('alt');
//         logo = img.attr('src');
//     }
//     console.log(schid + "--" + name + "--" + dname + "--" + logo);
//     if (schid && name && dname && logo) {
//         channel = new Channel(rules.rules[0].site, schid, name, dname, logo);
//         return channel;
//     }
//     else {
//         return null;
//     }
// }
// var getLinks = function ($) {
//     var linkArray = [];
//     var links = $("a");
//     links.each(function () {
//         var href = $(this).attr("href");
//         var expr = new RegExp(rules.rules[0].pattern);
//         if (expr.exec(href)) {
//             linkArray.push(href);
//         } else {
//             var expr2 = new RegExp(start);
//             if (!expr2.exec(href)) {
//                 if (typeof(href) == "string") {
//                     var prefix = urlInfo.protocol + "\/\/" + urlInfo.host;
//                     href = url.resolve(urlInfo.protocol + "//" + urlInfo.host, href);
//                     if (expr.exec(href)) {
//                         linkArray.push(href);
//                     }
//                 }
//             }
//         }
//
//     })
//     return linkArray;
// }
// var getPage = function (url, cb) {
//     var channelEpg = null;
//     var date = null;
//     var epg = [];
//     console.log("url : " + url + " is stating");
//     jsdom.env({
//         url: url,
//         userAgent: "YisouSpider",
//         features: {
//             FetchExternalResources: ["script"/*, "frame", "iframe", "link", "img"*/],
//             ProcessExternalResources: ["script"],
//             MutationEvents: '2.0'
//         },
//         src: [jquery],
//         done: function (err, window) {
//             if (err) {
//                 cb(err);
//             } else if (window.$) {
//                 console.log("request is done");
//                 var getEpg = function () {
//                     var $ = window.$;
//                     var isNull = $("#pgrow > li> div");
//                     if (isNull.length == 0) {
//                         cb({code: 1, message: "Error : " + url + "该页面没有数据"});
//                     }
//                     var night = $('#night');
//                     if (night.length == 0) {
//
//                         return setTimeout(getEpg, 1000);
//                     }
//                     var epgList = $("#pgrow > li");
//                     var monthDay = $("body > div.epghdc > dl > dd.weekcur > span").text();
//                     monthDay = monthDay.split("-");
//                     epgList.each(function () {
//                         if (!$(this).attr("id") && !date) {
//                             var timeString = $(this).find("div.over_hide > span.p_show >a").attr("res");
//                             if (timeString) {
//                                 var date1 = timeString.split('_')[0];
//                                 var date2 = date1.split("-")[0];
//                                 date = new Date(date2);
//                             }
//                         }
//                     });
//                     if (!date) {
//                         date = new Date();
//                     }
//                     date.setMonth(parseInt(monthDay[0] - 1), parseInt(monthDay[1]));
//                     epgList.each(function () {
//                         if (!$(this).attr("id")) {
//                             var time = $(this).find("div.over_hide > span:nth-child(1)").text();
//                             time = time.split(":");
//                             var program = $(this).find("div.over_hide > span.p_show").text();
//                             var starttime = date;
//                             starttime.setHours(parseInt(time[0]) + 8, time[1]);
//                             if (starttime != 'Invalid Date' && program) {
//                                 epg.push({starttime: starttime.getTime(), program: program});
//                             } else {
//                                 cb("Invalid Date");
//                             }
//                         }
//
//                     });
//                     channelEpg = new ChannelEpg(rules.rules[0].site, "", date.getTime(), url);
//                     epg.forEach(function (item, index, epg) {
//                         channelEpg.addProgram(item.starttime, item.program);
//                     });
//                     var links = getLinks($);
//                     var channel = getChannel($, url);
//                     channelEpg.schid = channel.schid;
//                     if (links.length > 0 && channel && channelEpg) {
//                         cb(null, links, channel, channelEpg);
//                     } else {
//                         cb("Error links length <=0 or channelInfo not exists");
//                     }
//                 }
//                 setTimeout(getEpg, 1000);
//             } else {
//                 cb("Error:dom 获取失败");
//             }
//         }
//     });
// }
// var saveChannel = function (links, channelObj, channelEpg, cb) {
//     ChannelModel.Model.findOne({site: channelObj.site, schid: channelObj.schid}, function (err, channel) {
//         if (err) {
//             cb({code: 0, message: "Error : " + err});
//         } else {
//             if (!channel) {
//                 ChannelModel.save(channelObj, function (err) {
//                     if (err) {
//                         cb({code: 0, message: "Error : " + err});
//                     }
//                     console.log(channelObj.name + " saved!")
//                     cb(null, links, channelEpg)
//                 })
//             }
//             else if (channel.name != channelObj.name || channel.dname != channelObj.dname || channel.logo != channelObj.logo) {
//                 channel.name = channelObj.name;
//                 channel.dname = channelObj.dname;
//                 channel.logo = channelObj.logo;
//                 channel.utime = channelObj.utime;
//                 channel.save(function (err) {
//                     if (err) {
//                         cb({code: 0, message: "Error : " + err});
//                     } else {
//                         console.log(channelObj.name + "saved!")
//                         cb(null, links, channelEpg)
//                     }
//                 });
//             }
//             else {
//                 console.log(channelObj.name + " has exsist!");
//                 cb(null, links, channelEpg);
//             }
//         }
//     })
// }
// var saveChannelEpg = function (links, channelEpgObj, cb) {
//     var newEpg = Hasher.GetMD5(channelEpgObj.epg.join(""));
//     ChannelEpgModel.Model.findOne({
//         schid: channelEpgObj.schid,
//         date: channelEpgObj.date
//     }, function (err, channelEpg) {
//         if (err) {
//             cb({code: 0, message: "Error : " + err});
//         } else {
//             if (!channelEpg) {
//                 ChannelEpgModel.save(channelEpgObj, function (err) {
//                     if (err) {
//                         cb({code: 0, message: "Error : " + err});
//                     } else {
//                         console.log(channelEpgObj.schid + " saved");
//                         cb(null, links);
//                     }
//                 })
//             } else {
//                 var oldEpg = Hasher.GetMD5(channelEpg.epg.join(""));
//                 if (newEpg == oldEpg) {
//                     console.log(channelEpgObj.schid + " exsist");
//                     cb(null, links);
//                 } else {
//                     channelEpg.epg = channelEpgObj.epg;
//                     channelEpg.save(function (err) {
//                         if (err) {
//                             cb({code: 0, message: "Error : " + err});
//                         } else {
//                             console.log(channelEpgObj.schid + " update");
//                             cb(null, links);
//                         }
//                     })
//                 }
//             }
//         }
//
//     });
// }
// if (cluster.isMaster) {
//     queue.on('error', function (err) {
//         console.error(JSON.stringify({role: 'scheduler', err: err}));
//     });
//     createJob([baseUrl], Callback);
//     var logStat = function () {
//         queue.inactiveCount(function (err, total) {
//             console.log('inactive: ' + total);
//         });
//     };
//     var logInterval = null;
//     logInterval = setInterval(logStat, 10000);
//     for (var i = 0; i < numCPUs; i++) {
//         cluster.fork();
//     }
//     cluster.on('exit', function (worker, code, signal) {
//         console.log('worker ' + worker.process.pid + ' died');
//     });
//     var quitCallback = function () {
//         queue.shutdown(1000, function (err) {
//             for (var id in cluster.workers) {
//                 console.log('Closing worker id: ' + id);
//                 cluster.workers[id].kill('SIGTERM');
//             }
//             setTimeout(function () {
//                 process.exit(0);
//             }, 3000);
//         });
//     }
// } else {
//     queue.process("crawllingUrl", function (job, done) {
//         console.log(job.id + ": is doing");
//         var jobCallback = function (err, result) {
//             if (err) {
//                 console.log(job.id + ": is failed");
//                 console.log(err);
//                 done(err);
//             } else {
//                 console.log(job.id + ": is completed");
//                 done();
//             }
//         }
//         async.waterfall([async.apply(getPage, job.data.url), saveChannel, saveChannelEpg, createJob], jobCallback);
//     })
// }
jsdom.env({
    url: "https://www.tvsou.com/epg/CCTV-1/20171029?class=yangshi",
    userAgent: "YisouSpider",
    features: {
        FetchExternalResources: ["script"/*, "frame", "iframe", "link", "img"*/],
        ProcessExternalResources: ["script"],
        MutationEvents: '2.0'
    },
    src: [jquery],
    done: function (err, window) {
        if (err) {
            console.error(err);
        } else {
            var $ = window.$;
            var channel = {};
            var schid = null;
            var name = null;
            var dname = null;
            var logo = null;
            var obj = this;
            var channelInfo = $("body > div.mr > div.tv-more-channel > div.tv-table.tv-channel-main.relative.ov > div.sidebar.l > div.channel-box.channel-boxs.cd-l-list > ul > li.relative.active > a");
            var result = channelInfo.attr("href").split("?");
            name = result[0].split("/")[2];
            schid = result[1].split("=")[1] + "-" + name;
            dname = channelInfo.attr("title");
            var img = channelInfo.find("img");
            if (img.length > 0) {
                logo = "http:" + img.attr('src');
            }
            console.log(schid + "--" + name + "--" + dname + "--" + logo);
            if (schid && name && dname && logo) {
                channel = new Channel(obj.site, schid, name, dname, logo);
            }
            // console.log(channel.toString())
            var epg = [];
            var pattern = new RegExp("^(https| http):\/\/www.tvsou.com\/epg\/(.+)\/(\\d{8})\\?class=(yangshi|weishi)$");
            var parseDate = /(\d{4})(\d{2})(\d{2})/;
            var patternResult = null;
            var date;

            patternResult = pattern.exec("https://www.tvsou.com/epg/CCTV-1/20171029?class=yangshi")
            console.log(patternResult);
            if (patternResult) {
                date = new Date(patternResult[3].replace(parseDate, '$1-$2-$3'));
            } else {
                date = new Date();
            }
            console.log(date);
            date.setHours(0, 0, 0, 0);
            var epgList = $("body > div.mr > div.tv-more-channel > div.tv-table.tv-channel-main.relative.ov > div.rightbox.r.tit-top.table-list.relative > div.play-time-more.mt-20 > ol > li")
            if (epgList && epgList != 'undefined' && epgList.length > 0) {
                epgList.each(function () {
                    var timeArray = $(this).find("span").text().split(":");
                    var starttime = new Date();
                    starttime.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
                    starttime.setHours(parseInt(timeArray[0]), timeArray[1], 0, 0);
                    var program = $(this).find("a").text();
                    if (starttime != 'Invalid Date' && program) {
                        epg.push({starttime: starttime.getTime(), program: program});
                    } else {
                        return null;
                    }
                });
                epg.sort(function (a, b) {
                    if (a.starttime < b.starttime) {
                        return -1;
                    } else if (a.starttime > b.starttime) {
                        return 1
                    } else {
                        return 0;
                    }
                });
                var channelEpg = new ChannelEpg("tvsou", "", date.getTime(), "https://www.tvsou.com/epg/CCTV-1/20171029?class=yangshi");
                epg.forEach(function (item, index, epg) {
                    channelEpg.addProgram(item.starttime, item.program);
                });
                console.log(channelEpg.toString())
            }
        }
    }
})

// var start=new RegExp("^(http|https):\/\/www.tvsou.com\/epg\/(.+)\\?class=(yangshi|weishi)$")
// console.log(start.exec("https://www.tvsou.com/epg/GXTV--1/20171031?class=weishi"))