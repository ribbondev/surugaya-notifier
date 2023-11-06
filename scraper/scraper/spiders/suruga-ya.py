from pathlib import Path

import scrapy


class ProductsSpider(scrapy.Spider):
    name = "suruga-ya"

    def __init__(self, *args, **kwargs):
        super(ProductsSpider, self).__init__(*args, **kwargs)
        self.start_urls = [kwargs.get('url')]

    def parse(self, response):
        for item in response.css("#products > .item"):
            categories = []

            for category in item.css(".cate_product a"):
                categories.append({
                    "name": category.css("::text").get(),
                    "url": category.css("::attr(href)").get(),
                })

            yield {
                "id": item.css(".title_product > a::attr(data-product-id)").get(),
                "url": item.css(".title_product > a::attr(href)").get(),
                "name": item.css(".title_product > a::text").get(),
                "image": item.css(".img_product img::attr(src)").get(),
                "date": item.css('.launch_date::text').get()[15:],
                "categories": categories,
                "price": item.css(".price-new::text").get(),
            }

        yield from response.follow_all(css="ul.pagination > li > a", callback=self.parse)