'use strict';

const fs = require('node:fs');
const path = require('node:path');
const child_process = require('node:child_process');

const CATEGORY = process.env.NOTIFY_CATEGORY;
const KEYWORD = process.env.NOTIFY_KEYWORD;
const WEBHOOK_URL = process.env.NOTIFY_WEBHOOK_URL;

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

	return parse(buffer);
}

const populateInitialState = async () =>
{
	if (fs.existsSync('./state/last.json'))
		return false;

	console.log('storing current results as initial state');

	const initial = await parseRemote(CATEGORY, KEYWORD);

	await fs.promises.mkdir('./state', { recursive: true });
	await fs.promises.writeFile('./state/last.json', JSON.stringify(initial));

	return true;
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
	await fetch(WEBHOOK_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
}

const compare = async () =>
{
	const previous = JSON.parse(await fs.promises.readFile('./state/last.json', 'utf8'))
	const current = await parseRemote(CATEGORY, KEYWORD);

	const added = Object.keys(current).filter(id => !previous[id]).map(id => current[id]);

	console.log(`found ${added.length} new products`);

	if (!added.length)
		return;

	await fs.promises.writeFile('./state/last.json', JSON.stringify(current));

	const embeds = [];

	for (const product of added)
		embeds.push(makeEmbed(product));

	for (let i = 0; i < embeds.length; i += 10)
		await fireWebhook(embeds.slice(i, i + 10));
}

(async () =>
{
	setInterval(compare, 15 * 60 * 1000);

	if (await populateInitialState())
		return;

	await compare();
}) ();

process.on('SIGTERM', () => process.exit(0));