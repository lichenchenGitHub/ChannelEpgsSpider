/**
 * Created by lichenchen on 2016/11/18.
 */
var Promise = require("bluebird");
var jsdom = require("jsdom");
var fs = require("fs");
var jquery = fs.readFileSync('./public/javascripts/jquery-1.11.3.min.js').toString();
var Channel = require('../model/tv/channel');
var ChannelEpg = require('../model/tv/channelepg');
var url = require("url");

function ChannelPageParser(site, url, pattern, ras, headers, level) {
    this.site = site;
    this.url = url;
    this.pattern = pattern;
    this.ras = ras;
    this.headers = headers;
    this.level = level;
    this.dom = null;
}
ChannelPageParser.prototype.constructor = ChannelPageParser;
ChannelPageParser.prototype.urlResolve = function () {
    var obj = {};
    var urlInfo = url.parse(this.url);
    var start = "/^" + urlInfo.protocol + "\\/\\/" + urlInfo.host + "*$/";
    ;
    var prefix = urlInfo.protocol + "\/\/" + urlInfo.host;
    var pattern = this.pattern;
    obj.start = start;
    obj.prefix = prefix;
    obj.pattern = pattern;
    return obj;
}
ChannelPageParser.prototype.getLinks = function () {
    if (this.dom) {
        var linkArray = [];
        var $ = this.dom;
        var obj = this;
        var links = $("a");
        links.each(function () {
            var href = $(this).attr("href");
            if (typeof(href) == "string") {
                var rule = obj.urlResolve(this.url);
                var start = new RegExp(rule.start);
                var pattern = new RegExp(rule.pattern);
                var prefix = rule.prefix;
                if (start.exec(href)) {
                    if (pattern.exec(href)) {
                        linkArray.push(href);
                    }
                } else {
                    href = prefix + href;
                    if (pattern.exec(href)) {
                        linkArray.push(href);
                    }
                }
            }
        })
        return linkArray;
    } else {
        return null;
    }
}
ChannelPageParser.prototype.getChannel = function () {
    if (this.dom) {
        var $ = this.dom;
        var schid = null;
        var name = null;
        var dname = null;
        var logo = null;
        var result = null;
        var channel = null;
        result = /(\w+):\/\/([^\:|\/]+)(\:\d*)?(.*\/)([^#|\?|\n]+)?(#.*)?(\?.*)?/i.exec(this.url)[5].split(".")[0].split("-");
        if (result) {
            if (result.length >= 4) {
                name = result[1];
                for (var i = 2; i < result.length - 1; i++) {
                    name += "-" + result[i];
                }
                schid = result[0] + '-' + name;
            } else if (result.length <= 2) {
                name = result[0];
                schid = result[0];

            } else {
                name = result[1];
                schid = result[0] + '-' + name;
            }
        }
        var img = $('div.pgmain > div.clear > h1>img');
        if (img.length > 0) {
            dname = img.attr('alt');
            logo = img.attr('src');
        }
        console.log(schid + "--" + name + "--" + dname + "--" + logo);
        if (schid && name && dname && logo) {
            channel = new Channel(this.site, schid, name, dname, logo);
            return channel;
        }
        else {
            return null;
        }
    } else {
        return null;
    }
}
ChannelPageParser.prototype.getPageInfo = function () {
    var channelEpg = null;
    var date = null;
    var epg = [];
    var url = this.url;
    var level = this.level;
    var starttime = null;
    var obj = this;
    console.log("ready to get " + this.url + " pageData at " + new Date());
    return new Promise(function (resolve, reject) {
        jsdom.env({
            url: url,
            userAgent: this.headers,
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
                console.log("get " + url + " pageData success at " + new Date());
                if (window.$) {
                    var getEpg = function () {
                        obj.dom = window.$;
                        var $ = obj.dom;
                        var isNull = $("#pgrow > li> div");
                        if (!isNull || isNull.length == 0) {
                            window.close();
                            reject({code: -1, message: "Error : " + url + "该页面没有数据"});
                        } else {
                            var night = $('#night');
                            if (night.length == 0) {
                                return setTimeout(getEpg, 1000);
                            }
                            var dname = $("div.pgmain > div.clear > h1>img").attr('alt');
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
                            date.setHours(0, 0, 0, 0);
                            epgList.each(function () {
                                if (!$(this).attr("id")) {
                                    var time = $(this).find("div.over_hide > span:nth-child(1)").text();
                                    time = time.split(":");
                                    var program = $(this).find("div.over_hide > span.p_show").text();
                                    starttime = new Date();
                                    starttime.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
                                    starttime.setHours(parseInt(time[0]), time[1], 0, 0);
                                    if (starttime != 'Invalid Date' && program) {
                                        epg.push({starttime: starttime.getTime(), program: program});
                                    } else {
                                        window.close();
                                        reject({code: -1, message: "get item time Error"})
                                    }
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
                            channelEpg = new ChannelEpg(obj.site, "", date.getTime(), url, dname);
                            epg.forEach(function (item, index, epg) {
                                channelEpg.addProgram(item.starttime, item.program);
                            });
                            var links = obj.getLinks();
                            var channel = obj.getChannel();
                            if (links.length <= 0 || !channel) {
                                window.close();
                                reject({code: -1, message: "获取连接或者频道信息出错"})
                            }
                            channelEpg.schid = channel.schid;
                            window.close();
                            resolve([channel, channelEpg, links, obj]);
                        }

                    }
                    setTimeout(getEpg, 1000);
                } else {
                    window.close();
                    reject({code: -1, message: "get window dom Error"});
                }
            }

        })
    });
}
module.exports = ChannelPageParser;



