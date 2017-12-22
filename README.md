# ChannelEpgsSpider
use redis+nodejs+kue crawl https://www.tvsou.com/ and http://www.tvmao.com/  program notice
实现功能：定时定向爬取http://www.tvmao.com/  tv锚全网站的节目预告信息、https://www.tvsou.com/ 搜视网全站的节目预告信息。
框架：express + mongodb+redis实现数据递归爬取
采用redis 实现key去重和url的存储，jsdom解析网页元素，正则匹配url推送到redis队列，mongodb存储数据爬取到的数据。
