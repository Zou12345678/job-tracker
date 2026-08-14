const captureBtn = document.getElementById('captureBtn');
const statusEl = document.getElementById('status');
const previewEl = document.getElementById('preview');

function capturePageData() {
  function flatten(value, output = []) {
    if (!value) return output;
    if (Array.isArray(value)) value.forEach(item => flatten(item, output));
    else if (typeof value === 'object') {
      output.push(value);
      if (value['@graph']) flatten(value['@graph'], output);
    }
    return output;
  }

  const jsonObjects = [];
  document.querySelectorAll('script[type="application/ld+json"]').forEach(node => {
    try { flatten(JSON.parse(node.textContent), jsonObjects); } catch (_) {}
  });
  const job = jsonObjects.find(item => {
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
  const org = typeof job.hiringOrganization === 'string' ? job.hiringOrganization : job.hiringOrganization?.name;
  const locations = Array.isArray(job.jobLocation) ? job.jobLocation : [job.jobLocation].filter(Boolean);
  const city = locations.map(location => {
    const address = location?.address || location;
    return [address?.addressLocality, address?.addressRegion].filter(Boolean).join(' ');
  }).filter(Boolean).join(' / ');

  return {
    url: location.href,
    title: job.title || firstText(['h1', '[class*="job-title"]', '[class*="jobTitle"]']) || meta('og:title') || document.title,
    company: org || firstText(['[data-testid*="company"]', '[class*="company-name"]', '[class*="companyName"]', '[class*="company_title"]']) || meta('og:site_name'),
    city,
    pageTitle: document.title,
    pageText: (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 50000)
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
  if (!match) return '';
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
    const titleParts = tidy(raw.pageTitle).split(/[_|｜·-]/).map(item => item.trim()).filter(Boolean);
    company = titleParts.find(part => part !== position && !/招聘|职位|BOSS|猎聘|智联|前程|拉勾|牛客|实习僧/.test(part)) || '待确认公司';
  }
  return {
    company: company.slice(0, 60),
    position: position.slice(0, 80),
    city: tidy(raw.city || inferCity(`${raw.pageTitle} ${raw.pageText}`)).slice(0, 30),
    applicationUrl: raw.url,
    applicationDate: inferApplicationDate(raw.pageText || ''),
    stage: inferStage(raw.pageText || '')
  };
}

function encodePayload(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function showPreview(data) {
  const escape = value => String(value || '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  previewEl.innerHTML = `
    <div class="item"><span class="label">公司</span><span class="value">${escape(data.company)}</span></div>
    <div class="item"><span class="label">岗位</span><span class="value">${escape(data.position)}</span></div>
    <div class="item"><span class="label">城市</span><span class="value">${escape(data.city || '待确认')}</span></div>`;
}

captureBtn.addEventListener('click', async () => {
  captureBtn.disabled = true;
  statusEl.className = 'status';
  statusEl.textContent = '正在识别当前页面…';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https?:/i.test(tab.url || '')) throw new Error('请先打开一个招聘岗位网页');
    const result = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: capturePageData });
    const captured = normalizeCaptured(result[0]?.result || {});
    showPreview(captured);
    const { trackerUrl } = await chrome.storage.local.get('trackerUrl');
    if (!trackerUrl) throw new Error('请先用当前浏览器打开一次秋招管理器');
    const destination = new URL(trackerUrl);
    destination.searchParams.set('capture', encodePayload(captured));
    await chrome.tabs.create({ url: destination.href });
    statusEl.textContent = '已发送，请在管理器中确认保存';
  } catch (error) {
    statusEl.className = 'status error';
    statusEl.textContent = error.message || '识别失败，请换一个岗位页面重试';
  } finally {
    captureBtn.disabled = false;
  }
});

document.getElementById('settingsBtn').addEventListener('click', () => chrome.runtime.openOptionsPage());
