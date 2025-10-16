// Load CSVs, compute metrics, and render charts

const fmtCurrency = (n) => n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const fmtPct = (n) => (n * 100).toFixed(1) + '%';

async function loadCSV(path) {
  const res = await fetch(path);
  const text = await res.text();
  return new Promise((resolve) => {
    Papa.parse(text, { header: true, dynamicTyping: true, complete: (r) => resolve(r.data) });
  });
}

function parseDate(s) {
  // Expect ISO string: YYYY-MM-DDTHH:MM
  return new Date(s);
}

function mean(arr) { return arr.reduce((a,b)=>a+b,0) / (arr.length || 1); }

function bootstrapCI(dataA, dataB, B = 2000) {
  // Returns mean diff and 95% CI using bootstrap resampling
  const mA = mean(dataA);
  const mB = mean(dataB);
  const diff = mA - mB;
  const diffs = [];
  for (let i = 0; i < B; i++) {
    const sampleA = Array.from({length: dataA.length}, () => dataA[Math.floor(Math.random()*dataA.length)]);
    const sampleB = Array.from({length: dataB.length}, () => dataB[Math.floor(Math.random()*dataB.length)]);
    diffs.push(mean(sampleA) - mean(sampleB));
  }
  diffs.sort((x,y)=>x-y);
  const lo = diffs[Math.floor(0.025 * B)];
  const hi = diffs[Math.floor(0.975 * B)];
  return { diff, lo, hi };
}

function groupSum(arr, keyFn, valFn) {
  const m = new Map();
  for (const x of arr) {
    const k = keyFn(x);
    const v = valFn(x);
    m.set(k, (m.get(k) || 0) + v);
  }
  return m;
}

function toShareMap(map) {
  const total = Array.from(map.values()).reduce((a,b)=>a+b,0) || 1;
  const out = new Map();
  for (const [k,v] of map.entries()) out.set(k, v/total);
  return out;
}

async function main() {
  const [orders, customers, products] = await Promise.all([
    loadCSV('data/orders.csv'),
    loadCSV('data/customers.csv'),
    loadCSV('data/products.csv'),
  ]);

  // Enrich orders
  const prodById = new Map(products.map(p => [p.product_id, p]));
  const custById = new Map(customers.map(c => [c.customer_id, c]));
  orders.forEach(o => {
    o.order_dt = parseDate(o.order_date);
    o.revenue = (o.quantity || 0) * (o.unit_price || 0);
    const p = prodById.get(o.product_id);
    const c = custById.get(o.customer_id);
    o.category = p ? p.category : 'Unknown';
    o.segment = c ? c.segment : 'Unknown';
    o.country = c ? c.country : 'Unknown';
  });

  const totalRev = orders.reduce((s,o)=>s+o.revenue,0);
  const AOV = totalRev / (orders.length || 1);

  // Repeat metrics: buyers base
  const ordersByCust = new Map();
  const revByCust = new Map();
  for (const o of orders) {
    ordersByCust.set(o.customer_id, (ordersByCust.get(o.customer_id) || 0) + 1);
    revByCust.set(o.customer_id, (revByCust.get(o.customer_id) || 0) + o.revenue);
  }
  const buyers = Array.from(ordersByCust.keys());
  const repeatBuyers = buyers.filter(c => (ordersByCust.get(c) || 0) > 1);
  const repeatRateBuyers = (repeatBuyers.length) / (buyers.length || 1);
  const repeatRevShare = repeatBuyers.reduce((s,c)=>s+(revByCust.get(c)||0),0) / (totalRev || 1);

  // Weekend/evening shares
  const weekendRev = orders.filter(o => [6,0].includes(o.order_dt.getDay())).reduce((s,o)=>s+o.revenue,0); // Sun(0), Sat(6)
  const weekdayRev = totalRev - weekendRev;
  const eveningRev = orders.filter(o => o.order_dt.getHours() >= 18 && o.order_dt.getHours() <= 22).reduce((s,o)=>s+o.revenue,0);

  // Monthly revenue
  const monthRev = groupSum(orders, o => o.order_dt.getMonth()+1, o => o.revenue);

  // Category mixes overall, holidays, summer
  const catOverall = groupSum(orders, o => o.category, o => o.revenue);
  const catNovDec = groupSum(orders.filter(o => [11,12].includes(o.order_dt.getMonth()+1)), o => o.category, o => o.revenue);
  const catSummer = groupSum(orders.filter(o => [6,7,8].includes(o.order_dt.getMonth()+1)), o => o.category, o => o.revenue);

  // Pareto curve (buyers only)
  const buyerRevs = buyers.map(c => revByCust.get(c) || 0).sort((a,b)=>b-a);
  const cumShares = buyerRevs.map((_,i)=> buyerRevs.slice(0,i+1).reduce((s,x)=>s+x,0) / (totalRev||1));
  const pctLabels = buyerRevs.map((_,i)=> Math.round(((i+1)/buyerRevs.length)*100));

  // Channel AOV + bootstrap CI
  const webRevs = orders.filter(o => o.channel==='Web').map(o=>o.revenue);
  const mobileRevs = orders.filter(o => o.channel==='Mobile').map(o=>o.revenue);
  const webMean = mean(webRevs);
  const mobileMean = mean(mobileRevs);
  const { diff, lo, hi } = bootstrapCI(webRevs, mobileRevs, 2000);
  const channelShare = toShareMap(groupSum(orders, o => o.channel, o => o.revenue));

  // Payment shares
  const payShares = toShareMap(groupSum(orders, o => o.payment_method, o => o.revenue));

  // Geo shares
  const geoShares = toShareMap(groupSum(orders, o => o.country, o => o.revenue));

  // BF/Cyber window metrics
  const year = orders[0] ? orders[0].order_dt.getFullYear() : new Date().getFullYear();
  const bfStart = new Date(year, 10, 20); // Nov is 10
  const bfEnd = new Date(year, 10, 30, 23, 59);
  const bfOrders = orders.filter(o => o.order_dt >= bfStart && o.order_dt <= bfEnd);
  const nonbfOrders = orders.filter(o => !(o.order_dt >= bfStart && o.order_dt <= bfEnd));
  const bfRevShare = bfOrders.reduce((s,o)=>s+o.revenue,0) / (totalRev||1);
  const bfDiscRate = (bfOrders.filter(o=> (o.discount||0) > 0).length) / (bfOrders.length || 1);
  const nonbfDiscRate = (nonbfOrders.filter(o=> (o.discount||0) > 0).length) / (nonbfOrders.length || 1);
  const bfAvgDiscOnly = mean(bfOrders.filter(o=> (o.discount||0) > 0).map(o=>o.discount||0)) || 0;
  const nonbfAvgDiscOnly = mean(nonbfOrders.filter(o=> (o.discount||0) > 0).map(o=>o.discount||0)) || 0;

  // Churn computations (buyers base)
  const endDate = orders.reduce((max, o) => o.order_dt > max ? o.order_dt : max, new Date(0));
  function computeChurn(windowDays) {
    const cutoff = new Date(endDate.getTime() - windowDays*24*3600*1000);
    const buyersSet = new Set(buyers);
    const lastOrder = new Map();
    for (const o of orders) {
      const dt = o.order_dt;
      const prev = lastOrder.get(o.customer_id) || new Date(0);
      if (dt > prev) lastOrder.set(o.customer_id, dt);
    }
    let churned = 0;
    for (const c of buyersSet) {
      const lo = lastOrder.get(c) || new Date(0);
      if (lo < cutoff) churned++;
    }
    return { rate: churned / (buyersSet.size || 1), churned, buyers: buyersSet.size, cutoff };
  }
  const churn60 = computeChurn(60);
  const churn90 = computeChurn(90);
  const churn120 = computeChurn(120);
  const churn180 = computeChurn(180);

  // Cohort retention matrix
  const firstOrder = new Map();
  for (const o of orders.sort((a,b)=>a.order_dt-b.order_dt)) {
    if (!firstOrder.has(o.customer_id)) firstOrder.set(o.customer_id, o.order_dt);
  }
  const ym = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  const cohortMembers = new Map();
  for (const [cid, dt] of firstOrder.entries()) {
    const key = ym(dt);
    if (!cohortMembers.has(key)) cohortMembers.set(key, new Set());
    cohortMembers.get(key).add(cid);
  }
  const buyersByMonth = new Map();
  for (const o of orders) {
    const key = ym(o.order_dt);
    if (!buyersByMonth.has(key)) buyersByMonth.set(key, new Set());
    buyersByMonth.get(key).add(o.customer_id);
  }
  const months = Array.from(new Set([...buyersByMonth.keys(), ...cohortMembers.keys()])).sort();
  const retention = months.map((mi, iIdx) => {
    const cohort = cohortMembers.get(mi) || new Set();
    return months.map((mj, jIdx) => {
      if (jIdx < iIdx) return null;
      const buyersSet = buyersByMonth.get(mj) || new Set();
      const kept = Array.from(cohort).filter(c => buyersSet.has(c)).length;
      return cohort.size ? kept / cohort.size : 0;
    });
  });

  // KPIs
  document.getElementById('kpi-total-rev').textContent = fmtCurrency(totalRev);
  document.getElementById('kpi-aov').textContent = fmtCurrency(AOV);
  document.getElementById('kpi-repeat-rate').textContent = fmtPct(repeatRateBuyers);
  document.getElementById('kpi-repeat-note').textContent = `Buyers: ${buyers.length} of ${customers.length} customers bought at least once.`;
  document.getElementById('kpi-repeat-rev').textContent = fmtPct(repeatRevShare);
  document.getElementById('kpi-weekend').textContent = fmtPct(weekendRev / (totalRev||1));
  document.getElementById('kpi-evening').textContent = fmtPct(eveningRev / (totalRev||1));
  const chWeb = fmtPct(channelShare.get('Web') || 0);
  const chMobile = fmtPct(channelShare.get('Mobile') || 0);
  document.getElementById('kpi-channel-share').textContent = `${chWeb} / ${chMobile}`;

  // Top months and categories lists (compact)
  const topMonths = Array.from(monthRev.entries()).sort((a,b)=>b[1]-a[1]).slice(0,3)
    .map(([m,v]) => `${m}: ${fmtPct(v/(totalRev||1))}`).join(' • ');
  document.getElementById('kpi-top-months').textContent = topMonths;
  const catOverallShare = Array.from(toShareMap(catOverall).entries()).sort((a,b)=>b[1]-a[1]).slice(0,3)
    .map(([c,s]) => `${c}: ${fmtPct(s)}`).join(' • ');
  document.getElementById('kpi-top-cats').textContent = catOverallShare;

  // Chart helpers
  const palette = [ '#58a6ff', '#f78166', '#8b949e', '#d2a8ff', '#79c0ff', '#ffa657', '#56d364', '#f2cc60' ];

  // Monthly revenue bar
  new Chart(document.getElementById('chart-month'), {
    type: 'bar',
    data: {
      labels: Array.from({length:12}, (_,i)=>String(i+1)),
      datasets: [{
        label: 'Revenue',
        data: Array.from({length:12}, (_,i)=> monthRev.get(i+1) || 0),
        backgroundColor: '#58a6ff'
      }]
    },
    options: { scales: { y: { ticks: { callback: (v)=>'$'+v } } } }
  });

  // Category mixes stacked
  const cats = Array.from(new Set([...catOverall.keys(), ...catNovDec.keys(), ...catSummer.keys()]));
  new Chart(document.getElementById('chart-category'), {
    type: 'bar',
    data: {
      labels: ['Overall', 'Nov-Dec', 'Summer'],
      datasets: cats.map((cat, idx) => ({
        label: cat,
        data: [catOverall.get(cat)||0, catNovDec.get(cat)||0, catSummer.get(cat)||0],
        backgroundColor: palette[idx % palette.length]
      }))
    },
    options: { plugins: { legend: { position: 'bottom' } }, scales: { y: { stacked: true }, x: { stacked: true } } }
  });

  // Pareto curve
  new Chart(document.getElementById('chart-pareto'), {
    type: 'line',
    data: { labels: pctLabels, datasets: [{ label: 'Cumulative revenue share', data: cumShares.map(s=>s*100), borderColor: '#56d364', tension: 0.2 }] },
    options: { scales: { y: { ticks: { callback: (v)=>v+'%' }, min:0, max:100 } }, plugins: { legend: { display: false } } }
  });

  // Channel AOV bar with CI text
  new Chart(document.getElementById('chart-channel-aov'), {
    type: 'bar',
    data: {
      labels: ['Web', 'Mobile'],
      datasets: [{ label: 'AOV', data: [webMean, mobileMean], backgroundColor: ['#58a6ff', '#f78166'] }]
    },
    options: { scales: { y: { ticks: { callback: (v)=>'$'+Math.round(v) } } } }
  });
  const ciNote = `Diff (Web - Mobile): ${fmtCurrency(diff)}; 95% CI [${fmtCurrency(lo)} to ${fmtCurrency(hi)}]`;
  document.getElementById('note-channel-aov').textContent = ciNote;

  // Payment share doughnut
  const payLabels = Array.from(payShares.keys());
  const payVals = payLabels.map(k=>payShares.get(k)*100);
  new Chart(document.getElementById('chart-payments'), {
    type: 'doughnut',
    data: { labels: payLabels, datasets: [{ data: payVals, backgroundColor: palette }] },
    options: { plugins: { legend: { position: 'bottom' } } }
  });

  // Geo share bar
  const geoLabels = Array.from(geoShares.keys());
  const geoVals = geoLabels.map(k=>geoShares.get(k)*100);
  new Chart(document.getElementById('chart-geo'), {
    type: 'bar',
    data: { labels: geoLabels, datasets: [{ label: 'Revenue share', data: geoVals, backgroundColor: '#d2a8ff' }] },
    options: { scales: { y: { ticks: { callback: (v)=>v+'%' }, min:0, max:100 } } }
  });

  // Promotions KPIs
  document.getElementById('bf-rev-share').textContent = fmtPct(bfRevShare);
  document.getElementById('bf-disc-rate').textContent = fmtPct(bfDiscRate);
  document.getElementById('bf-avg-disc').textContent = (bfAvgDiscOnly*100).toFixed(1)+'%';
  document.getElementById('nonbf-disc-rate').textContent = fmtPct(nonbfDiscRate);
  document.getElementById('nonbf-avg-disc').textContent = (nonbfAvgDiscOnly*100).toFixed(1)+'%';

  // Fill churn KPIs and interactive window
  const setChurn = (obj) => {
    const el = document.getElementById('kpi-churn-selected');
    if (el) {
      el.textContent = fmtPct(obj.rate);
      const note = document.getElementById('kpi-churn-selected-note');
      if (note) note.textContent = `${obj.churned}/${obj.buyers} buyers inactive since ${obj.cutoff.toISOString().slice(0,10)}`;
    }
  };
  const el60 = document.getElementById('kpi-churn-60'); if (el60) el60.textContent = fmtPct(churn60.rate);
  const el90 = document.getElementById('kpi-churn-90'); if (el90) el90.textContent = fmtPct(churn90.rate);
  const el120 = document.getElementById('kpi-churn-120'); if (el120) el120.textContent = fmtPct(churn120.rate);
  const el180 = document.getElementById('kpi-churn-180'); if (el180) el180.textContent = fmtPct(churn180.rate);
  const sel = document.getElementById('churn-window');
  if (sel) {
    const updateSelected = () => { const v = parseInt(sel.value, 10); setChurn(computeChurn(v)); };
    sel.addEventListener('change', updateSelected);
    updateSelected();
  }

  // Render cohort retention heatmap
  const container = document.getElementById('cohort-heatmap');
  if (container) {
    container.innerHTML = '';
    const colorFor = (p) => {
      const t = Math.min(1, Math.max(0, p));
      const start = [31,37,48]; // #1f2530
      const end = [88,166,255]; // accent
      const rgb = start.map((s,i)=> Math.round(s + (end[i]-s)*t));
      return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
    };
    // header row
    const header = document.createElement('div'); header.className = 'heat-row';
    const hlabel = document.createElement('div'); hlabel.className = 'heat-label'; hlabel.textContent = 'Cohort \\ Month';
    const hcells = document.createElement('div'); hcells.className = 'heat-cells';
    months.forEach(m => { const cell = document.createElement('div'); cell.className = 'heat-cell'; cell.style.background = '#1f2530'; cell.setAttribute('data-pct',''); cell.title = m; hcells.appendChild(cell); });
    header.appendChild(hlabel); header.appendChild(hcells); container.appendChild(header);
    // rows
    retention.forEach((row,iIdx) => {
      const rowEl = document.createElement('div'); rowEl.className = 'heat-row';
      const label = document.createElement('div'); label.className = 'heat-label'; label.textContent = months[iIdx];
      const cells = document.createElement('div'); cells.className = 'heat-cells';
      row.forEach((val,jIdx) => {
        const cell = document.createElement('div'); cell.className = 'heat-cell';
        if (val === null) { cell.style.background = '#0e1117'; cell.setAttribute('data-pct',''); }
        else { cell.style.background = colorFor(val); cell.setAttribute('data-pct', Math.round(val*100)); cell.title = `${months[iIdx]} → ${months[jIdx]}: ${fmtPct(val)}`; }
        cells.appendChild(cell);
      });
      rowEl.appendChild(label); rowEl.appendChild(cells); container.appendChild(rowEl);
    });
    const legend = document.createElement('div'); legend.className = 'heat-legend';
    const low = document.createElement('span'); low.className = 'legend-label'; low.textContent = 'Low';
    const bar = document.createElement('div'); bar.className = 'legend-bar';
    const high = document.createElement('span'); high.className = 'legend-label'; high.textContent = 'High';
    legend.appendChild(low); legend.appendChild(bar); legend.appendChild(high);
    container.appendChild(legend);
    const note = document.getElementById('note-cohort'); if (note) note.textContent = 'Cells show per-month retention by cohort (share of cohort buying in each subsequent month).';
  }
}

main().catch(err => {
  console.error(err);
  alert('Failed to load dashboard data. Ensure data/*.csv are present.');
});
