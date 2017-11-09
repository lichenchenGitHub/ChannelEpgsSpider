/**
 * Created by lichenchen on 2016/11/15.
 */
var express = require('express');
var url = require('url'); //解析操作url
var superagent = require('superagent'); //这三个外部依赖不要忘记npm install
var cheerio = require('cheerio');
var eventproxy = require('eventproxy');
var targetUrl = 'http://www.tvmao.com/program/CCTV-CCTV1-w2.html';
superagent.get(targetUrl)
    .end(function (err, res) {
        var $ = cheerio.load(res.text);
        console.log(
        $(function(){var b="src";var d=A.d("a",b);$.get("/api/pg",{p:d},function(a){if(a[0]==1){$("#noon").after(a[1])}},"json")}))


    });
