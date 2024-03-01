const process = require('node:process');
const puppeteer = require('puppeteer');

const isDebug = process.env.IS_DEBUGGING;
let browser = null;
let headlessPre = true;
const getBrowser = async (headless = true) => {
	if (headlessPre != headless) {
		await closeBrowser();
		headlessPre = headless;
	}
	if (!browser) {
		const params = {
			headless: headless,
			args: [
				'--no-sandbox',
				'–no-first-run', // 没有设置首页。在启动的时候，就会打开一个空白页面。
				'--disable-blink-features=AutomationControlled'
			]
		};

		browser = await puppeteer.launch(params);
		return browser;
	}
	return browser;
};

const closeBrowser = async () => {
	if (browser) {
		await browser.close();
		browser = null;
	}
};

module.exports = {
	getBrowser,
	closeBrowser
};

