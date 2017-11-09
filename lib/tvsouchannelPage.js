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
    var start = "^" + urlInfo.protocol + "\/\/" + urlInfo.host + "*";
    var filter = "^(http|https):\/\/www.tvsou.com\/epg\/(.+)\/(\\d{8})\\?class=(yangshi|weishi)$";
    var prefix = urlInfo.protocol + "\/\/" + urlInfo.host;
    var pattern = this.pattern;
    obj.start = start;
    obj.prefix = prefix;
    obj.pattern = pattern;
    obj.filter = filter;
    return obj;
}
ChannelPageParser.prototype.getLinks = function () {
    if (this.dom) {
        var linkArray = [];
        var $ = this.dom;
        var obj = this;
        var links = $("a");
        if (links && links.length >= 0) {
            links.each(function () {
                var href = $(this).attr("href");
                if (typeof(href) == "string") {
                    var result = null;
                    var rule = obj.urlResolve(this.url);
                    var start = new RegExp(rule.start);
                    var pattern = new RegExp(rule.pattern);
                    var filter = new RegExp(rule.filter);
                    var prefix = rule.prefix;
                    if (start.exec(href)) {
                        if (pattern.exec(href)) {
                            linkArray.push(href);
                            // result = filter.exec(href);
                            // if (result) {
                            //     var nowDate = getMonday();
                            //     if (result[3]) {
                            //         var date = new Date(result.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'));
                            //         if (nowDate.getTime() <= date.getTime()) {
                            //             linkArray.push(href);
                            //         }
                            //     }
                            //
                            // } else {
                            //     linkArray.push(href);
                            // }
                        }
                    } else {
                        href = prefix + href;
                        if (pattern.exec(href)) {
                            linkArray.push(href);
                        }
                        // var filterResult = filter.exec(href);
                        // if (filterResult) {
                        //     linkArray.push(href)
                        //     console.log(href);
                        //     var nowDate = getMonday();
                        //     var date = new Date(filterResult[2].replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'));
                        //     console.log(nowDate);
                        //     console.log(date);
                        //     if (nowDate.getTime() <= date.getTime()) {
                        //         linkArray.push(href);
                        //     }
                        // } else if (pattern.exec(href)) {
                        //     linkArray.push(href);
                        // }
                    }
                }
            })
            return linkArray;
        } else {
            return null;
        }
    } else {
        return null;
    }
}
ChannelPageParser.prototype.getChannel = function () {
    if (this.dom) {
        var $ = this.dom;
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
            return channel;
        }
        else {
            return null;
        }
    } else {
        return null;
    }
}
ChannelPageParser.prototype.getEpg = function () {
    if (this.dom) {
        var $ = this.dom;
        var obj = this;
        var channelEpg = null;
        var date = null;
        var starttime = null;
        var epg = [];

        var pattern = new RegExp("^(http|https):\/\/www.tvsou.com\/epg\/(.+)\/(\\d{8})\\?class=(yangshi|weishi)$");
        var dname = $("body > div.mr > div.tv-more-channel > div.tv-table.tv-channel-main.relative.ov > div.sidebar.l > div.channel-box.channel-boxs.cd-l-list > ul > li.relative.active > a").attr("title");
        var parseDate = /(\d{4})(\d{2})(\d{2})/;
        var patternResult = null;
        patternResult = pattern.exec(this.url)
        if (patternResult) {
            date = new Date(patternResult[3].replace(parseDate, '$1-$2-$3'));
        } else {
            date = new Date();
        }
        date.setHours(0, 0, 0, 0);
        var epgList = $("body > div.mr > div.tv-more-channel > div.tv-table.tv-channel-main.relative.ov > div.rightbox.r.tit-top.table-list.relative > div.play-time-more.mt-20 > ol > li")
        if (epgList && epgList != 'undefined' && epgList.length > 0) {
            epgList.each(function () {
                var timeArray = $(this).find("span").text().split(":");
                starttime = new Date();
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
            channelEpg = new ChannelEpg(obj.site, "", date.getTime(), obj.url, dname);
            epg.forEach(function (item, index, epg) {
                channelEpg.addProgram(item.starttime, item.program);
            });
            return channelEpg;
        } else {
            return null;
        }
    } else {
        return null;
    }
}
ChannelPageParser.prototype.getPageInfo = function () {
    var url = this.url;
    var level = this.level;
    var obj = this;
    console.log("ready to get " + this.url + " pageData at " + new Date());
    return new Promise(function (resolve, reject) {
        jsdom.env({
            url: url,
            src: [jquery],
            done: function (err, window) {
                if (err) {
                    reject({code: -1, message: "get window error"});
                }
                console.log("get " + url + " pageData success at " + new Date());
                if (window.$) {
                    obj.dom = window.$;
                    var channelEpg = obj.getEpg();
                    var links = obj.getLinks();
                    var channel = obj.getChannel();
                    if (channel && links && obj && channelEpg) {
                        channelEpg.schid = channel.schid;
                        window.close();
                        resolve([channel, channelEpg, links, obj]);
                    } else {
                        window.close();
                        reject({code: -1, message: "parameters lack"})
                    }

                } else {
                    window.close();
                    reject({code: -1, message: "get window dom Error"});
                }
            }

        })
    });
}
var getMonday = function () {
    var date = new Date();
    var nowTime = date.getTime();
    var day = date.getDay();
    var oneDayLong = 24 * 60 * 60 * 1000;
    var MondayTime = nowTime - (day - 1) * oneDayLong;
    var monday = new Date(MondayTime);
    monday.setHours(8, 0, 0, 0)
    return monday;

}
module.exports = ChannelPageParser;

