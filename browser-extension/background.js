function extractJobPage() {
  function flatten(value, output = []) {
    if (!value) return output;
    if (Array.isArray(value)) value.forEach(item => flatten(item, output));
    else if (typeof value === 'object') {
      output.push(value);
      if (value['@graph']) flatten(value['@graph'], output);
    }
    return output;
  }
  const objects = [];
  document.querySelectorAll('script[type="application/ld+json"]').forEach(node => {
    try { flatten(JSON.parse(node.textContent), objects); } catch (_) {}
  });
  const job = objects.find(item => {
    const type = item && item['@type'];
    return type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'));
  }) || {};
  const meta = name => document.querySelector(`meta[property="${name}"],meta[name="${name}"]`)?.content?.trim() || '';
  const firstText = selectors => {
    for (const selector of selectors) {
      const value = document.querySelector(selector)?.textContent?.trim();
      if (value && value.length < 160) return value;
    }
    return '';
  };
  const organization = typeof job.hiringOrganization === 'string' ? job.hiringOrganization : job.hiringOrganization?.name;
  const locations = Array.isArray(job.jobLocation) ? job.jobLocation : [job.jobLocation].filter(Boolean);
  const city = locations.map(location => {
    const address = location?.address || location;
    return [address?.addressLocality, address?.addressRegion].filter(Boolean).join(' ');
  }).filter(Boolean).join(' / ');
  return {
    url: location.href,
    title: job.title || firstText(['h1', '[class*="job-title"]', '[class*="jobTitle"]']) || meta('og:title') || document.title,
    company: organization || firstText(['[data-testid*="company"]', '[class*="company-name"]', '[class*="companyName"]', '[class*="company_title"]']) || meta('og:site_name'),
    city,
    pageTitle: document.title,
    pageText: (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 80000)
  };
}

function tidy(value) {
  return String(value || '').replace(/\s+/g, ' ').replace(/^招聘[:：]?\s*/, '').trim();
}

function inferCity(text) {
  const cities = ['北京','上海','广州','深圳','杭州','南京','苏州','成都','重庆','武汉','西安','长沙','天津','厦门','合肥','郑州','青岛','济南','宁波','无锡','珠海','佛山','东莞','福州','昆明','南昌','大连','沈阳','哈尔滨','石家庄','太原','贵阳','南宁','海口','兰州','乌鲁木齐','呼和浩特','长春','香港','澳门'];
  return cities.find(city => text.includes(city)) || '';
}

function inferApplicationDate(text) {
  const match = text.match(/(?:投递|申请)(?:时间|日期)?\s*[:：]?\s*(20\d{2})[.\/年-]\s*(\d{1,2})[.\/月-]\s*(\d{1,2})日?/);
  if (!match) return new Date().toLocaleDateString('sv-SE');
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
}

function inferStage(text) {
  const labeled = text.match(/(?:当前状态|投递状态|申请状态|招聘进度|求职进度)\s*[:：]?\s*([^\s，。|]{2,12})/);
  const value = labeled?.[1] || '';
  if (/offer|录用|待入职/i.test(value)) return 'Offer';
  if (/不合适|未通过|已拒绝|流程结束|招聘结束|已关闭/.test(value)) return '已结束';
  if (/HR面|hr面|人事面/i.test(value)) return 'HR面';
  if (/二面|第二轮|复试/.test(value)) return '二面';
  if (/一面|初面|第一轮/.test(value)) return '一面';
  if (/笔试|测评/.test(value)) return '笔试';
  return '已投递';
}

function normalizeCaptured(raw) {
  let position = tidy(raw.title);
  position = position.split(/\s[-_|｜·]\s|招聘职位|职位详情|校园招聘/)[0].trim() || '待确认岗位';
  let company = tidy(raw.company);
  if (!company || /BOSS直聘|猎聘|智联招聘|前程无忧|拉勾|牛客|实习僧|应届生求职网/i.test(company)) {
    const parts = tidy(raw.pageTitle).split(/[_|｜·-]/).map(item => item.trim()).filter(Boolean);
    company = parts.find(part => part !== position && !/招聘|职位|BOSS|猎聘|智联|前程|拉勾|牛客|实习僧/.test(part)) || '待确认公司';
  }
  return {
    company: company.slice(0, 60),
    position: position.slice(0, 80),
    city: tidy(raw.city || inferCity(`${raw.pageTitle} ${raw.pageText}`)).slice(0, 30),
    applicationDate: inferApplicationDate(raw.pageText || ''),
    stage: inferStage(raw.pageText || ''),
    applicationUrl: raw.url
  };
}

function waitForComplete(tabId) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('详情页加载超时，请确认网址可以正常访问。')), 18000);
    const listener = (changedId, info) => {
      if (changedId === tabId && info.status === 'complete') finish();
    };
    function finish(error) {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      error ? reject(error) : resolve();
    }
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then(tab => { if (tab.status === 'complete') finish(); }).catch(() => {});
  });
}

async function captureUrl(url) {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('只支持 http 或 https 投递网址。');
  const tab = await chrome.tabs.create({ url: parsed.href, active: false });
  try {
    await waitForComplete(tab.id);
    await new Promise(resolve => setTimeout(resolve, 900));
    const result = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractJobPage });
    return normalizeCaptured(result[0]?.result || {});
  } finally {
    if (tab?.id) chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function extractTencentSmartSheet() {
  const collected = new Map();
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const clean = value => String(value || '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const addRow = (text, cells = [], links = []) => {
    const cleanedText = clean(text);
    const cleanedCells = cells.map(clean).filter(Boolean).slice(0, 24);
    const cleanedLinks = [...new Set(links.map(String).filter(url => /^https?:\/\//i.test(url)))].slice(0, 8);
    if ((!cleanedText || cleanedText.length < 4) && cleanedCells.length < 2) return;
    if (cleanedText.length > 1500) return;
    const key = `${cleanedCells.join('|')}|${cleanedLinks.join('|')}|${cleanedText}`;
    collected.set(key, { text: cleanedText, cells: cleanedCells, links: cleanedLinks });
  };
  const collect = () => {
    const selectors = ['[role="row"]', '[data-record-id]', '[data-row-id]', '[class*="record-item"]', '[class*="table-row"]', '[class*="grid-row"]'];
    const nodes = [...document.querySelectorAll(selectors.join(','))].slice(0, 4000);
    nodes.forEach(node => {
      const text = clean(node.innerText || node.textContent || '');
      const cellNodes = [...node.querySelectorAll('[role="cell"], [role="gridcell"], td, [class*="cell"]')].slice(0, 30);
      const cells = cellNodes.length ? cellNodes.map(cell => clean(cell.innerText || cell.textContent || '')) : text.split(/\n|\t/).map(clean);
      const links = [...node.querySelectorAll('a[href]')].map(link => link.href);
      addRow(text, cells, links);
    });
    [...document.querySelectorAll('a[href]')].slice(0, 3000).forEach(link => {
      let container = link;
      for (let depth = 0; depth < 6 && container?.parentElement; depth += 1) {
        container = container.parentElement;
        const text = clean(container.innerText || '');
        if (text.length >= 8 && text.length <= 800) {
          addRow(text, text.split(/\n|\t/).map(clean), [link.href]);
          break;
        }
      }
    });
    const lines = clean(document.body?.innerText || '').split('\n').map(clean).filter(Boolean);
    lines.forEach(line => {
      if (line.includes('\t') || /实习|校招|秋招|春招|管培|工程师|开发|算法|产品|运营|设计|分析|顾问|招聘/.test(line)) addRow(line, line.split(/\t|[|｜]/).map(clean), []);
    });
  };

  await wait(2600);
  collect();
  const candidates = [document.scrollingElement, ...document.querySelectorAll('main, [role="grid"], [class*="scroll"], [class*="table"], [class*="content"]')]
    .filter(Boolean)
    .filter((element, index, array) => array.indexOf(element) === index && element.scrollHeight > element.clientHeight + 200)
    .sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight));
  const scroller = candidates[0];
  if (scroller) {
    const originalTop = scroller.scrollTop;
    let unchanged = 0;
    let previousSize = collected.size;
    for (let index = 0; index < 90; index += 1) {
      const before = scroller.scrollTop;
      scroller.scrollTop = Math.min(scroller.scrollHeight, before + Math.max(420, scroller.clientHeight * 0.82));
      await wait(180);
      collect();
      unchanged = collected.size === previousSize ? unchanged + 1 : 0;
      previousSize = collected.size;
      if (scroller.scrollTop === before || scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 5 || unchanged >= 8) break;
    }
    scroller.scrollTop = originalTop;
  }
  return { title: document.title, url: location.href, rows: [...collected.values()].slice(0, 3000) };
}

async function syncTencentJobs(url) {
  const parsed = new URL(url);
  if (parsed.hostname !== 'docs.qq.com' || !parsed.pathname.startsWith('/smartsheet/')) throw new Error('这不是支持的腾讯智能表格网址。');
  const tab = await chrome.tabs.create({ url: parsed.href, active: false });
  try {
    try { await waitForComplete(tab.id); } catch (_) {}
    const result = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractTencentSmartSheet });
    const data = result[0]?.result || {};
    if (!Array.isArray(data.rows) || !data.rows.length) throw new Error('没有读取到岗位，请确认已登录并且可以查看这份腾讯文档。');
    return data.rows;
  } finally {
    if (tab?.id) chrome.tabs.remove(tab.id).catch(() => {});
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!['CAPTURE_JOB_URL', 'SYNC_QQ_JOBS'].includes(message?.type)) return false;
  const task = message.type === 'SYNC_QQ_JOBS' ? syncTencentJobs(message.url) : captureUrl(message.url);
  task
    .then(data => sendResponse(message.type === 'SYNC_QQ_JOBS' ? { ok: true, rows: data } : { ok: true, data }))
    .catch(error => sendResponse({ ok: false, message: error.message || '识别失败，请重试。' }));
  return true;
});
