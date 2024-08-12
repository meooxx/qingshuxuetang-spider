const fs = require('node:fs');
const fetch = (...args) =>
	import('node-fetch').then(({ default: fetch }) => fetch(...args));
const querystring = require('node:querystring');
const { getBrowser, closeBrowser } = require('./browser');

const UA =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4240.198 Safari/537.36';

const context = {
	cookie: null,
	UA
};
async function isLoginFn() {
	if (!context.cookie) return false;
	const browser = await getBrowser();
	const page = await browser.newPage();
	await page.setUserAgent(UA);
	await page.setCookie(...context.cookie);
	await page.goto('https://degree.qingshuxuetang.com/njupt/Student/Home');

	if (page.url().includes('Student/Home')) {
		return true;
	}
	await closeBrowser();
	return false;
}

async function writeCookie(cookies) {
	fs.writeFileSync('cookie.json', cookies);
}
async function loadCookie() {
	if (context.cookie) {
		return context.cookie;
	}
	try {
		const buf = fs.readFileSync('cookie.json', {
			encoding: 'utf-8'
		});
		const json = JSON.parse(buf);

		context.cookie = json.map(i => {
			return {
				name: i.name,
				value: i.value,
				domain: 'degree.qingshuxuetang.com'
			};
		});
		return json;
	} catch (e) {
		console.log('正常报错', e.message);
		console.log('没有读取到cookie, 重新登陆');
	}
	return null;
}

async function login() {
	const browser = await getBrowser(false);
	const page = await browser.newPage();
	page.setUserAgent(UA);
	// page.setViewport();
	await page.goto('https://degree.qingshuxuetang.com/njupt/Home');
	await page.waitForNavigation({
		timeout: 0
	});
	const cookies = await page.cookies();
	await writeCookie(JSON.stringify(cookies));
	context.cookie = cookies;
	await page.close();
	await closeBrowser();
}

async function getAuthedPage() {
	const cookies = await loadCookie();
	const browser = await getBrowser();
	const page = await browser.newPage();
	await page.setUserAgent(context.UA);
	await page.setCookie(...cookies);
	return page;
}

async function getCourses() {
	const page = await getAuthedPage();
	await page.goto('https://degree.qingshuxuetang.com/njupt/Student/Home');
	const courses = await page.$$('.course-item');
	const regex = /'([^']*)'/g;

	const allCourse = await Promise.all(
		courses.map(async i => {
			const onclickStr = await i.$eval('.course-btn', node =>
				node.getAttribute('onclick')
			);
			const matches = [];
			while ((match = regex.exec(onclickStr))) {
				matches.push(match[1]);
			}
			const regPecent = /(\d+)\/\d+/;
			const processText = await i.$eval(
				'.course-progress-name',
				node => node.innerText
			);
			const process = parseInt(processText.match(regPecent)?.[1] || 0);
			if (process == 100) {
				return null;
			}
			return {
				name: await i.$eval('.course-name', node => node.innerText),
				process,
				args: await matches.slice(1, 4)
			};
		})
	);
	await page.close();
	// ignore that's done
	return allCourse.filter(Boolean);
}

async function recordTime(params) {
	const beginParams = {
		headers: {
			'Device-Trace-Id-QS': params.traceId,
			'User-Agent': params.ua,
			Cookie: params.cookie,
			'Content-Type': 'application/json',
			Referer: params.referer
		},
		method: 'POST',
		body: JSON.stringify({
			classId: params.teachPlanId,
			contentId: params.contentId,
			contentType: 11,
			courseId: params.courseId,
			detectId: null,
			periodId: params.periodId,
			position: params.positionStart
		})
	};
	const res = await fetch(
		`https://degree.qingshuxuetang.com/njupt/Student/Course/UploadStudyRecordBegin?_t=${Date.now()}`,
		beginParams
	).then(r => {
		const json = r.json();
		return json;
	});

	await new Promise(r => {
		setTimeout(r, 60 * 1000);
	});
	let start = params.positionStart;
	const duration = params.positionEnd;

	const loop = async () => {
		const formData = new FormData();
		formData.append('recordId', res.data);
		formData.append('end', start >= duration);
		formData.append('position', Math.min(start, duration));
		formData.append('timeOutConfirm', false);

		await fetch(
			`https://degree.qingshuxuetang.com/njupt/Student/Course/UploadStudyRecordContinue?_t=${Date.now()}`,
			{
				headers: {
					'Device-Trace-Id-QS': params.traceId,
					'User-Agent': params.ua,
					Cookie: params.cookie,

					// 'Content-Type': 'Application/json',
					Referer: params.referer
				},
				method: 'POST',
				body: formData
			}
		)
			.then(async r => {
				if (r.status == 401) {
					console.log('登陆失效请重新启动');
					process.exit(0);
				}
				const res = await r.json();
				if (res.data != null) {
					console.log(r.message);
				} else {
					console.log(`增加时间:+1m`);
				}
			})
			.catch(e => {
				console.log('正常报错', e.message);
			});
		if (start < duration) {
			start += 1 * 60;
			await new Promise(r => {
				setTimeout(r, 60 * 1000);
			});
			return loop();
		}
	};
	await loop();
}

async function runTask(course) {
	console.info('开始课程:', course.name);
	await new Promise(r => setTimeout(r, 1000));
	const page = await getAuthedPage();
	const param = {
		classId: '',
		courseId: course.args[0],
		teachPlanId: course.args[1],
		periodId: course.args[2]
	};
	const search = querystring.encode(param);
	await Promise.all([
		page.goto(
			'https://degree.qingshuxuetang.com/njupt/Student/Course/CourseStudy' +
				`?${search}`
		),
		page.waitForSelector('#list .node').catch(e => {
			return page.reload(
				'https://degree.qingshuxuetang.com/njupt/Student/Course/CourseStudy' +
					`?${search}`
			);
		})
	]);

	const curriculars$ = await page.$('#list');
	const list = await curriculars$.$$eval('a', a =>
		a.map(node => {
			const timesText =
				node.querySelector('.mark.study_being')?.innerText || '';
			const regex = /\s(\d+)次/;
			const match = timesText.match(regex);
			let times = 0;
			if (match) {
				times = match[1];
			}
			const name = node.querySelector('.title')?.innerText || '';
			return {
				id: node.getAttribute('id'),
				name: name,
				times: times
			};
		})
	);
	const validIds = list
		.filter(i => i && i.times < 3)
		.filter(i => i && Boolean(i.id))
		.map(i => {
			return { ...i, id: i.id.split('-')[1] };
		});
	const videoPage = await getAuthedPage();
	for (let i = 0; i < validIds.length; i++) {
		const id = validIds[i].id;
		console.info('开始小结:', validIds[i].name);
		await Promise.all([
			videoPage.goto(
				'https://degree.qingshuxuetang.com/njupt/Student/Course/CourseShow' +
					`?${search}&nodeId=${id}`
			),
			videoPage
				.waitForResponse(
					response => {
						const headers = response.headers();
						return headers['content-type'] === 'video/mp4';
					},
					{
						timeout: 5000
					}
				)
				.catch(e => {
					console.log('正常报错', e.message);
					console.log('课件文档, 没有视频');
				})
		]);

		// const contentInfo = videoPage.evalueHandle(() => {});
		const duration = Math.floor(
			await videoPage
				.$eval('#vjs_video_3_html5_api', node => node?.duration || 60 * 10)
				.catch(e => {
					return 60 * 10;
				})
		);

		const traceId = await page.evaluate(() => {
			return localStorage.getItem('Device-Trace-Id-QS');
		});
		let concurrent = 5;
		concurrent -= Math.round(Math.random() * 2);
		cookie = context.cookie
			.map(i => {
				return `${i.name}=${i.value}`;
			})
			.join(';');
		const promies = [];
		for (let i = 0; i < concurrent; i++) {
			promies.push(
				recordTime({
					traceId,
					ua: context.UA,
					cookie: cookie,
					referer:
						'https://degree.qingshuxuetang.com/njupt/Student/Course/CourseShow' +
						`?${search}`,
					classId: param.teachPlanId,
					teachPlanId: param.teachPlanId,
					contentId: id,
					contentType: 11,
					courseId: param.courseId,
					periodId: param.periodId,
					positionStart: Math.floor(duration / concurrent) * i,
					positionEnd: Math.floor(duration / concurrent) * (i + 1)
				})
			);
			await new Promise(r => setTimeout(r, 2000));
		}
		await Promise.allSettled(promies);
	}
}
async function Run() {
	await loadCookie();
	const isLogin = await isLoginFn();
	if (!isLogin) {
		console.log('请在程序打开的浏览器上进行登陆');
		await login();
		console.log('登陆成功');
	}
	const courses = await getCourses();
	while (courses.length > 0) {
		await runTask(courses.shift());
	}
	console.log('课程结束');
	process.exit(1);
}

//
Run();

