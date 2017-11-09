/**
 * Created by lichenchen on 2016/11/15.
 */
//var jsdom = require("jsdom");
//var fs=require("fs");
//var jquery = fs.readFileSync('./public/javascripts/jquery-1.11.3.min.js').toString();
//jsdom.env({
//    url: "http://www.tvmao.com/program_satellite/NXTV2-w2.html",
//    userAgent: "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/51.0.2704.106 Safari/537.36",
//    features: {
//        FetchExternalResources: ["script"/*, "frame", "iframe", "link", "img"*/],
//        ProcessExternalResources: ["script"],
//        MutationEvents: '2.0'
//    },
//    src: [jquery],
//    done: function (err, window) {
//        if(window.A)
//        {
//            console.log(window.A);
//            var b="src";
//            var d=window.A.d("a",b);
//            var superagent = require('superagent');
//            console.log("http://www.tvmao.com/api/pg?="+d);
//            superagent.get("http://www.tvmao.com/api/pg?p="+d) .end(function (err, res) {
//                console.log(res.text);
//            });
//        }else{
//            console.log("获取A失败");
//        }
//
//    }
//});
//var rule=new RegExp("^http:\/\/www.tvsou.com\/epg\/(.+)?class=(yangshi|weishi)");
//console.log(rule.exec("http://www.tvsou.com/epg/BTV-1?class=beijing-110000"))


//var date = new Date("/epg/hunandianshitai-hnws/20161122?class=weishi".split("?")[0].split("/")[3].replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'));
//var rules=require("./conf/rules").rules;
//var getMonday = function () {
//    var nowTime = new Date().getTime();
//    var day = date.getDay();
//    var oneDayLong = 24 * 60 * 60 * 1000;
//    var MondayTime = nowTime - (day - 1) * oneDayLong;
//    var monday = new Date(MondayTime);
//    monday.setHours(8,0,0,0)
//    return monday;
//
//}
//var pattern=rules[1].pattern;
//var exec=new RegExp(pattern);
//var pattern2="^http:\/\/www.tvsou.com\/epg\/(.+)\/(\\d{8})\\?class=(yangshi|weishi)$";
//var exec2=new RegExp(pattern2)
////console.log(exec.exec("http://www.tvsou.com/epg/cctv-1/20161123?class=yangshi"));
////console.log(exec.exec("http://www.tvsou.com/epg/cctv-1?class=yangshi"));
//console.log(exec.exec("http://www.tvsou.com/epg/cctv-1?class=yangshi"))
//console.log(exec2.exec("http://www.tvsou.com/epg/cctv-1/20161123?class=yangshi"));
//console.log(exec2.exec("http://www.tvsou.com/epg/cctv-1?class=yangshi"));
//console.log(exec2.exec("http://www.tvsou.com/epg/cctv-1?class=yangshi"));
//var a=1;
//var b=a;
//b++;
//console.log("a:"+a+",b:"+b);
//var result = /(\w+):\/\/([^\:|\/]+)(\:\d*)?(.*\/)([^#|\?|\n]+)?(#.*)?(\?.*)?/i.exec("http://www.tvmao.com/program_satellite/AHTV1-w2.html")[5].split(".")[0].split("-");
//if (result) {
//    if (result.length >= 4) {
//        name = result[1];
//        for (var i = 2; i < result.length - 1; i++) {
//            name += "-" + result[i];
//        }
//        schid = result[0] + '-' + name;
//    } else if (result.length <= 2) {
//        var canonNumber = new RegExp("([A-Z]+)(\\d{1,})");
//        var canonResult = canonNumber.exec(result[0]);
//        if (canonResult) {
//            name = result[0];
//            schid = canonResult[1];
//        } else {
//            name = result[0];
//            schid = result[0]
//        }
//
//    } else {
//        name = result[1];
//        schid = result[0] + '-' + name;
//    }
//    console.log("name :"+name+",schid:"+schid)
//}
var num1=1;
console.log("num1 :"+num1);
var num2=num1;
num2++;
console.log("\n num1:"+num1+"\n num2:"+num2)
var a=new Date();
console.log("a :"+a);
var b=a;
b.setHours(8,0,0,0);
var c= new Date(a);
c.setHours(10,0,0,0);
console.log("\n a:"+a+"\n b:"+b+"\n c:"+c);


