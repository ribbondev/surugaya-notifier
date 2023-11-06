'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const child_process = require('node:child_process');

const config = require('./config.json');

const parse = (buffer) =>
{
	const json = JSON.parse(buffer);
	const result = {};

	for (const product of json)
	{
		product.url = `https://www.suruga-ya.com${product.url}`;
		result[product.id] = product;
	}

	return result;
}

const parseRemote = async (category, keyword) =>
{
	const url = 'https://www.suruga-ya.com/en/products';
	const qs = new URLSearchParams({ btn_search: '', keyword, sort: 'updated_date_desc' });

	if (category)
		qs.set('category', category);

	console.log(`fetching ${url}?${qs}...`);

	const argv = ['-m', 'scrapy.cmdline', 'crawl', '--output=-:json', '-a', `url=${url}?${qs}`, 'suruga-ya'];
	const job = child_process.spawn('python', argv, {
		cwd: path.resolve('./scraper'),
		env: {
			'VIRTUAL_ENV': path.resolve('./venv/'),
			'PATH': path.resolve('./venv/bin') + path.delimiter + process.env.PATH,
		}
	});

	let buffer = '';
	job.stdout.on('data', data => buffer += data);

	await new Promise(resolve => job.on('close', resolve));
	console.log(`updated state for '${keyword}' [${category || 'all'}]`);

	return parse(buffer);
}

const populateInitialState = async () =>
{
	let stale = [];

	for (const topic of config.watchlist)
	{
		const filename = getStatePath(topic);

		if (fs.existsSync(filename))
		{
			stale.push(topic);
			continue;
		}

		console.log(`storing initial state for topic '${topic.keyword}' [${filename}]`);

		const initial = await parseRemote(topic.category || null, topic.keyword);

		await fs.promises.writeFile(filename, JSON.stringify(initial));
	}

	return stale;
}

const makeEmbed = (product) =>
{
	return {
		'title': product.name,
		'url': product.url,
		'color': null,
		'fields': [
			{
				'name': 'Release date',
				'value': product.date,
				'inline': true
			},
			{
				'name': 'Category',
				'value': product.categories.at(-1).name,
				'inline': true
			},
			{
				'name': 'Price',
				'value': product.price,
				'inline': true
			}
		],
		'author': {
			'name': 'Suruga-ya.com',
			'url': 'https://www.suruga-ya.com/en/',
			'icon_url': 'https://www.suruga-ya.com/sites/default/files_light/pwa/images/icons/favicon-32x32.png.webp?v=1'
		},
		'timestamp': new Date().toISOString(),
		'thumbnail': {
			'url': product.image,
		}
	};
}

const fireWebhook = async (embeds) =>
{
	const body = { 'content': null, embeds, 'attachments': [] };
	await fetch(config.webhook_url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
}

const getStatePath = (topic) =>
{
	const base = path.resolve('./data/state');

	if (!topic)
		return base;

	const hash = crypto.createHash('sha256');
	hash.update(topic.keyword + (topic.category || ''));

	return path.join(base, `${hash.digest('hex')}.json`);
}

const compare = async (topics) =>
{
	let watchlist = config.watchlist;

	if (topics && topics.length)
		watchlist = topics;

	for (const topic of watchlist)
	{
		console.log(`updating topic '${topic.keyword}' [${topic.category || 'all'}]`);

		const filename = getStatePath(topic);

		const previous = JSON.parse(await fs.promises.readFile(filename, 'utf8'))
		const current = await parseRemote(topic.category || null, topic.keyword);

		const added = Object.keys(current).filter(id => !previous[id]).map(id => current[id]);

		console.log(`found ${added.length} new products`);

		if (!added.length)
			continue;

		await fs.promises.writeFile(filename, JSON.stringify(current));

		const embeds = [];

		for (const product of added)
			embeds.push(makeEmbed(product));

		for (let i = 0; i < embeds.length; i += 10)
			await fireWebhook(embeds.slice(i, i + 10));
	}
}

(async () =>
{
	console.log(`watching ${config.watchlist.length} topic(s)`);
	console.log(`polling every ${config.poll_interval} minute(s)`);

	setInterval(compare, config.poll_interval * 60 * 1000);

	await fs.promises.mkdir(getStatePath(), { recursive: true });

	setTimeout(compare, 60 * 1000, await populateInitialState());
}) ();

process.on('SIGTERM', () => process.exit(0));