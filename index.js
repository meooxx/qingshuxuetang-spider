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
		console.log(e);
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
			return {
				name: await i.$eval('.course-name', node => node.innerText),
				process: await i.$eval('.course-progress-name', node => node.innerText),
				args: await matches.slice(1, 4)
			};
		})
	);
	await page.close();
	// ignore that's done
	return allCourse;
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
			return {
				id: node.getAttribute('id'),
				name: node.querySelector('.title')?.innerText || ''
			};
		})
	);
	const validIds = list
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
						timeout: 3000
					}
				)
				.catch(e => {
					console.log(e);
					console.log('课件, 没有视频');
				})
		]);

		// const contentInfo = videoPage.evalueHandle(() => {});
		const duration = Math.floor(
			await videoPage.$eval(
				'#vjs_video_3_html5_api',
				node => node?.duration || 60 * 10
			)
		);
		let start = 90;
		const traceId = await page.evaluate(() => {
			return localStorage.getItem('Device-Trace-Id-QS');
		});
		const beginParams = {
			headers: {
				'Device-Trace-Id-QS': traceId,
				'User-Agent': context.UA,
				Cookie: context.cookie
					.map(i => {
						return `${i.name}=${i.value}`;
					})
					.join(';'),
				'Content-Type': 'application/json',
				Referer:
					'https://degree.qingshuxuetang.com/njupt/Student/Course/CourseShow' +
					`?${search}`
			},
			method: 'POST',
			body: JSON.stringify({
				classId: param.teachPlanId,
				contentId: id,
				contentType: 11,
				courseId: param.courseId,
				detectId: null,
				periodId: param.periodId,
				position: start
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
			setTimeout(r, 51 * 1000);
		});
		const logId = res.data;
		const loop = async () => {
			console.log('开始增加时间:+2.5m');
			const formData = new FormData();
			formData.append('recordId', logId);
			formData.append('end', start >= duration);
			formData.append('position', start);
			formData.append('timeOutConfirm', false);
			return await fetch(
				`https://degree.qingshuxuetang.com/njupt/Student/Course/UploadStudyRecordContinue?_t=${Date.now()}`,
				{
					headers: {
						'Device-Trace-Id-QS': traceId,
						'User-Agent': context.UA,
						Cookie: context.cookie
							.map(i => {
								return `${i.name}=${i.value}`;
							})
							.join(';'),
						// 'Content-Type': 'Application/json',
						Referer:
							'https://degree.qingshuxuetang.com/njupt/Student/Course/CourseShow' +
							`?${search}`
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
					}
					return await new Promise(r => {
						setTimeout(r, 51 * 1000);
					});
				})
				.catch(e => {
					console.log(e);
				})
				.finally(() => {
					if (start < duration) {
						start += 2.5 * 60;
						return loop();
					}
				});
		};
		await loop();
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

