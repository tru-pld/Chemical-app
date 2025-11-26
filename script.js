// --- !!! สำคัญ !!! ---
// นี่คือ URL ใหม่ที่คุณได้มาหลังจากการ Deploy Apps Script (เวอร์ชัน Base64)
const GAS_URL = 'https://script.google.com/macros/s/AKfycbxX8vZokeSHa-X3SMXByaIeSau8nk10cHhRcTDux6kn2r4vF26FcfDW3IReQVVfPldM/exec'; // <-- อัปเดตแล้ว

// ข้อมูลการตรวจสอบ
const GAS_MONITORING_CONFIG = {
    'Oxygen (O₂)': { min: 0, max: 5937, alarmMin: 1696, unit: 'Kg', color: 'rgba(59, 130, 246, 1)', sheetName: 'Oxygen' },
    'Nitrogen (N₂)': { min: 0, max: 2500, alarmMin: 600, unit: 'Liter', color: 'rgba(251, 146, 60, 1)', sheetName: 'Nitrogen' },
    'Carbondioxide (CO₂)': { min: 0, max: 18500, alarmMin: 7000, unit: 'Liter', color: 'rgba(16, 185, 129, 1)', sheetName: 'Carbondioxide' },
    'Diesel B7': { min: 0, max: 20000, alarmMin: 7000, unit: 'Liter', color: 'rgba(124, 58, 237, 1)', sheetName: 'Diesel B7' }
};

const DARK_NAVY_COLOR = '#1E293B';
const CRITICAL_COLOR = 'rgba(220, 38, 38, 1)';
const BG_COLOR = 'rgba(209, 213, 219, 0.5)';

// --- 1. Inactivity Timeout (30 นาที) ---
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000; 
let inactivityTimer = null;

/**
 * สั่ง Logout เมื่อเวลา (30 นาที) หมด
 */
function handleInactivity() {
    console.log("User inactive. Logging out.");
    // [แก้ไข] เราจะสั่ง signOut() เท่านั้น
    // เพราะ onAuthStateChanged จะไปเรียก showLoginScreen
    // และ showLoginScreen จะเป็นคนหยุด Timer เอง
    firebase.auth().signOut();
}

/**
 * รีเซ็ตตัวจับเวลา 30 นาที (เมื่อมีการเคลื่อนไหว)
 */
function resetInactivityTimer() {
    if (inactivityTimer) {
        clearTimeout(inactivityTimer);
    }
    inactivityTimer = setTimeout(handleInactivity, INACTIVITY_TIMEOUT_MS);
}

/**
 * เริ่มการติดตาม (30 นาที)
 */
function startInactivityMonitor() {
    // กิจกรรมที่ถือว่า "Active"
    window.addEventListener('mousemove', resetInactivityTimer);
    window.addEventListener('mousedown', resetInactivityTimer);
    window.addEventListener('keypress', resetInactivityTimer);
    window.addEventListener('scroll', resetInactivityTimer);
    window.addEventListener('touch', resetInactivityTimer);
    
    resetInactivityTimer(); // เริ่มนับถอยหลังครั้งแรก
    console.log("Inactivity monitor started (30 min).");
}

/**
 * หยุดการติดตาม (30 นาที)
 */
function stopInactivityMonitor() {
    window.removeEventListener('mousemove', resetInactivityTimer);
    window.removeEventListener('mousedown', resetInactivityTimer);
    window.removeEventListener('keypress', resetInactivityTimer);
    window.removeEventListener('scroll', resetInactivityTimer);
    window.removeEventListener('touch', resetInactivityTimer);
    
    if (inactivityTimer) {
        clearTimeout(inactivityTimer);
        inactivityTimer = null;
    }
    console.log("Inactivity monitor stopped.");
}

// --- 2. Absolute Timeout (8 ชั่วโมง) ---
const ABSOLUTE_TIMEOUT_MS = 8 * 60 * 60 * 1000; 
let absoluteTimer = null;

/**
 * สั่ง Logout เมื่อเวลา (8 ชั่วโมง) หมด
 */
function handleAbsoluteTimeout() {
    console.log("Absolute session timeout (8 hours). Logging out.");
    // [แก้ไข] สั่ง signOut() เท่านั้น (เหมือนกับ handleInactivity)
    firebase.auth().signOut();
}

/**
 * หยุดการติดตาม (8 ชั่วโมง)
 */
function stopAbsoluteTimer() {
    if (absoluteTimer) {
        clearTimeout(absoluteTimer);
        absoluteTimer = null;
    }
    console.log("Absolute timer stopped (8 hours).");
}

let allData = [];
let gaugeCharts = {};
let lineCharts = {};
let isFirstLoad = true;
let renderedMonth = null;
let renderedYear = null;

let currentFilteredData = []; // สำหรับเก็บข้อมูล Report ที่กรองแล้ว

/**
 * แปลงวันที่และเวลาจาก Sheet (ที่อาจเป็นสตริง) ให้อยู่ในรูปแบบ Date Object
 */
function parseDateTime(dateValue, timeValue) {
    try {
        let dateObj = null;
        const dateStr = String(dateValue).split(' ')[0]; 

        if (dateStr.includes('T') && dateStr.endsWith('Z')) {
            dateObj = new Date(dateStr); 
        } else if (dateStr.includes('/')) {
            const parts = dateStr.split('/');
            if (parts.length === 3) {
                const year = parseInt(parts[2]);
                const month = parseInt(parts[0]);
                const day = parseInt(parts[1]);   
                dateObj = new Date(year, month - 1, day); 
            }
        }
        
        if (!dateObj || isNaN(dateObj.getTime())) {
            dateObj = new Date(dateValue);
        }

        if (dateObj && !isNaN(dateObj.getTime())) {
            const timeObj = new Date(timeValue);
            if (!isNaN(timeObj.getTime())) {
                dateObj.setHours(timeObj.getHours(), timeObj.getMinutes(), timeObj.getSeconds(), timeObj.getMilliseconds());
            }
            return dateObj;
        }
        
        return null;
        
    } catch (error) {
        console.error("Error parsing date/time:", dateValue, timeValue, error);
        return null;
    }
}

/**
 * ดึงข้อมูลจาก Google Apps Script URL (ขอข้อมูลหลัก)
 */
async function fetchDataFromGoogleSheet() {
    const maxRetries = 5;
    // เราจะใช้ action=getData เพื่อบอก GAS ว่าเราต้องการข้อมูลจาก Sheet
    const dataUrl = `${GAS_URL}?action=getData&v=${new Date().getTime()}`;

    for (let i = 0; i < maxRetries; i++) {
        try {
            console.log(`Fetching data... (Attempt ${i + 1})`);
            const response = await fetch(dataUrl, { 
                method: 'GET', 
                cache: 'no-cache',
                redirect: 'follow', // เพิ่ม redirect
                mode: 'cors'
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const rawData = await response.json();
            
            if (rawData.error) {
                throw new Error(`GAS Error: ${rawData.error}`);
            }
            
            allData = rawData
                .map(record => ({
                    ...record, // เก็บทุกฟิลด์ (Image, Employee Name ฯลฯ)
                    Remain: parseFloat(record.Remain), 
                    DateTime: parseDateTime(record.Date, record.Time) 
                }))
                .filter(record => record.DateTime && !isNaN(record.Remain))
                .sort((a, b) => b.DateTime - a.DateTime);
                
            console.log('Data fetched and processed successfully. Latest Data Sample:', allData.slice(0, 5));
            return "success"; // คืนค่า success

        } catch (error) {
            console.error('Fetch error:', error);
            const loadingStatus = document.getElementById('loading-status');
            if (i === maxRetries - 1) {
                if (loadingStatus) {
                    loadingStatus.textContent = '⚠️ ไม่สามารถโหลดข้อมูลได้';
                }
                throw error; // โยน error เพื่อให้ updateDashboardData() รู้ว่าล้มเหลว
            }
            const delay = Math.pow(2, i) * 1000 + Math.random() * 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    throw new Error("Failed to fetch data after retries.");
}

/**
 * หาข้อมูลล่าสุดของแต่ละ Gas Name
 */
function getLatestReadings(data) {
    const latest = {};
    for (const record of data) {
        const gasKey = record['Gas Name'].trim(); 
        if (gasKey && !latest[gasKey]) { 
            latest[gasKey] = record;
        }
    }
    return latest;
}

/**
 * Utility function to generate a consistent HTML ID
 */
function getSafeId(name) {
    return name.replace(/[^a-zA-Z0-9]/g, '-').replace(/--+/g, '-').replace(/^-|-$/g, '');
}

/**
 * เตรียมข้อมูลสำหรับ Line Chart (แยกตามเดือน/ปี)
 */
function prepareMonthlyData(data, month, year) {
    
    const gasKeyMap = Object.keys(GAS_MONITORING_CONFIG).reduce((acc, display) => {
        const sheetName = GAS_MONITORING_CONFIG[display].sheetName;
        acc[sheetName.trim()] = display; 
        return acc;
    }, {});

    const filteredData = data.filter(record => 
        record.DateTime.getMonth() === month && record.DateTime.getFullYear() === year
    );

    const groupedData = filteredData.reduce((acc, record) => {
        const gasKey = record['Gas Name'].trim(); 
        const gasDisplayName = gasKeyMap[gasKey]; 

        if (!gasDisplayName) return acc;
        if (!acc[gasDisplayName]) acc[gasDisplayName] = [];
        
        const day = record.DateTime.getDate(); 
        acc[gasDisplayName].push({ x: day, y: record.Remain });
        return acc;
    }, {});

    const chartData = {};
    for (const gas in groupedData) {
        const latestDailyData = groupedData[gas].reduce((acc, item) => {
            if (!acc[item.x]) {
                acc[item.x] = item.y;
            }
            return acc;
        }, {});

        const labels = Object.keys(latestDailyData).map(Number).sort((a, b) => a - b);
        const values = labels.map(day => latestDailyData[day]);

        chartData[gas] = {
            labels: labels.map(d => `${d}`), 
            data: values
        };
    }
    return chartData;
}

// --- Chart Rendering Functions ---

function updateDailyCharts() {
    const dailyContainer = document.getElementById('daily-monitoring-container');
    const gasNames = Object.keys(GAS_MONITORING_CONFIG);

    if (isFirstLoad) {
        const newCardsHtml = gasNames.map(gasName => {
            const config = GAS_MONITORING_CONFIG[gasName];
            const cardColorClass = 
                gasName.includes('Oxygen') ? 'text-blue-600' :
                gasName.includes('Nitrogen') ? 'text-orange-500' :
                gasName.includes('Carbondioxide') ? 'text-emerald-600' :
                gasName.includes('Diesel B7') ? 'text-purple-600' : 'text-gray-600';
            
            const cardId = `daily-card-${getSafeId(gasName)}`;
            const canvasId = `gauge-chart-${getSafeId(gasName)}`;

            return `
                <div class="card bg-white p-6 flex flex-col items-center text-center" id="${cardId}">
                    <h4 class="text-xl font-semibold mb-4 ${cardColorClass}">${gasName}</h4>
                    <div class="relative w-full max-w-xs mx-auto mb-4 flex justify-center" style="height: 140px;">
                        <canvas id="${canvasId}"></canvas>
                    </div>
                    <p class="text-sm text-gray-500">Min ${config.alarmMin} / Max ${config.max} ${config.unit}</p>
                </div>
            `;
        }).join('');
        dailyContainer.innerHTML = newCardsHtml;
    }

    const latestReadings = getLatestReadings(allData);
    
    gasNames.forEach(gasName => {
        const config = GAS_MONITORING_CONFIG[gasName];
        const sheetKey = (config.sheetName || gasName).trim(); 
        const record = latestReadings[sheetKey] || { Remain: 0 }; 
        
        if (config) {
            renderGaugeChart(gasName, record.Remain, config.min, config.max, config.alarmMin, config.unit);
        }
    });
    
    if (allData.length === 0) {
         gasNames.forEach(gasName => {
            const config = GAS_MONITORING_CONFIG[gasName];
            if (config) {
                renderGaugeChart(gasName, 0, config.min, config.max, config.alarmMin, config.unit);
            }
        });
    }
}

function renderGaugeChart(gasName, value, min, max, alarmMin, unit) {
    const config = GAS_MONITORING_CONFIG[gasName];
    const canvasId = `gauge-chart-${getSafeId(gasName)}`; 
    const canvasEl = document.getElementById(canvasId);
    if (!canvasEl) return;

    // [แก้ไขจุดที่ 1] ปัดเศษทศนิยมให้เหลือ 2 ตำแหน่งเสมอ ตั้งแต่เริ่มต้น
    const displayValue = parseFloat(value.toFixed(2)); 
    
    const chartValue = Math.min(Math.max(0, displayValue), max); 
    const remaining = parseFloat((max - chartValue).toFixed(2));
    
    const isCritical = displayValue <= alarmMin || displayValue > max;
    
    const currentDisplayColor = isCritical ? CRITICAL_COLOR : config.color;
    const currentBGColor = BG_COLOR;

    const gaugeLabel = {
        id: 'gaugeLabel',
        afterDraw(chart) {
            const { ctx, chartArea: { width, height } } = chart;
            ctx.save();
            
            const centerX = width / 2;
            const centerY = (height / 2) + 15; 

            const actualValue = chart.options.plugins.gaugeMetadata.actualValue;
            const alarmMinMeta = chart.options.plugins.gaugeMetadata.alarmMin;
            const maxMeta = chart.options.plugins.gaugeMetadata.max;
            
            const isLabelCritical = actualValue <= alarmMinMeta || actualValue > maxMeta;
            
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = '700 1.5rem "Noto Sans Thai", sans-serif'; 
            ctx.fillStyle = isLabelCritical ? CRITICAL_COLOR : config.color; 
            
            // [แก้ไขจุดที่ 2] บังคับแสดงผลตัวเลขทศนิยม 2 ตำแหน่ง (.toFixed(2)) เวลาวาดลงบน Canvas
            ctx.fillText(`${actualValue.toFixed(2)}`, centerX, centerY - 15); 
            
            ctx.font = '400 0.8rem "Noto Sans Thai", sans-serif';
            ctx.fillStyle = DARK_NAVY_COLOR;
            ctx.fillText(unit, centerX, centerY + 10);
            
            let statusText = 'Normal';
            if (actualValue > maxMeta) { 
                statusText = '🚨 Too High!'; 
            } else if (actualValue <= alarmMinMeta) {
                statusText = '⚠️ Too Low!'; 
            }
            
            ctx.font = '600 0.9rem "Noto Sans Thai", sans-serif';
            ctx.fillStyle = isLabelCritical ? CRITICAL_COLOR : config.color;
            ctx.fillText(statusText, centerX, centerY + 40);
            
            ctx.restore();
        }
    };

    const gaugeMetadata = {
        actualValue: displayValue, // ส่งค่าที่ปัดเศษแล้วไป
        alarmMin: alarmMin,
        max: max
    };


    if (gaugeCharts[gasName]) {
        gaugeCharts[gasName].data.datasets[0].data = [
            chartValue, 
            remaining > 0 ? remaining : 0
        ];
        gaugeCharts[gasName].data.datasets[0].backgroundColor = [currentDisplayColor, currentBGColor];
        gaugeCharts[gasName].data.datasets[0].borderColor = [currentDisplayColor, currentBGColor];
        gaugeCharts[gasName].options.plugins.gaugeMetadata = gaugeMetadata;
        gaugeCharts[gasName].update();

    } else {
        const data = {
            labels: ['Remain', 'Max'],
            datasets: [{
                data: [chartValue, remaining > 0 ? remaining : 0], 
                backgroundColor: [currentDisplayColor, currentBGColor],
                borderColor: [currentDisplayColor, currentBGColor],
                borderWidth: 1,
                cutout: '80%',
                circumference: 180,
                rotation: 270,
            }]
        };
        
        gaugeCharts[gasName] = new Chart(canvasEl, {
            type: 'doughnut',
            data: data,
            options: {
                responsive: true,
                maintainAspectRatio: true,
                aspectRatio: 1.5,
                plugins: {
                    legend: { display: false },
                    tooltip: { enabled: false },
                    gaugeMetadata: gaugeMetadata, 
                },
                scales: {
                    y: { display: false },
                    x: { display: false }
                },
                events: ['mousemove', 'mouseout', 'click', 'touchstart', 'touchmove', 'touchend'],
            },
            plugins: [gaugeLabel]
        });
    }
}

function renderOrUpdateLineChart(gasName, chartId, data) {
    const config = GAS_MONITORING_CONFIG[gasName];
    const canvasEl = document.getElementById(chartId);
    if (!canvasEl) return;

    const datasets = [{
        label: `Remain (${config.unit})`,
        data: data.data,
        borderColor: config.color,
        backgroundColor: config.color.replace('1)', '0.3)'), 
        borderWidth: 3, 
        tension: 0.4, 
        fill: true,
        pointRadius: 6,
        pointHoverRadius: 8
    }];

    const datalabelsConfig = {
        datalabels: {
            align: 'end', 
            anchor: 'end', 
            color: DARK_NAVY_COLOR,
            backgroundColor: 'rgba(255, 255, 255, 0.7)',
            borderRadius: 4,
            font: {
                weight: 'bold',
                size: 12 
            },
            formatter: (value) => {
                return value.toFixed(2); 
            }
        }
    };


    if (lineCharts[gasName]) {
        lineCharts[gasName].resize();
        lineCharts[gasName].data.labels = data.labels;
        lineCharts[gasName].data.datasets[0].data = data.data;
        lineCharts[gasName].options.plugins.title.text = gasName;
        lineCharts[gasName].update();
    } else {
        const chartConfig = {
            type: 'line',
            data: {
                labels: data.labels,
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    ...datalabelsConfig,
                    title: {
                        display: true,
                        text: gasName, 
                        color: DARK_NAVY_COLOR,
                        font: { size: 32, weight: 'bold' } 
                    },
                    legend: { display: false },
                    tooltip: { mode: 'index', intersect: false }
                },
                scales: {
                    x: {
                        title: { display: true, text: 'Date', 
                            color: DARK_NAVY_COLOR 
                        },
                        grid: { display: false }
                    },
                    y: {
                        title: { display: true, text: `Level (${config.unit})`, 
                            color: DARK_NAVY_COLOR 
                        },
                        min: 0,
                        max: config.max * 1.1, 
                    }
                }
            },
            plugins: [ChartDataLabels]
        };
        lineCharts[gasName] = new Chart(canvasEl, chartConfig);
    }
}

function setupFilters(latestDate) {
    const filterContainer = document.getElementById('monthly-filters');
    
    const initialMonth = latestDate ? latestDate.getMonth() : new Date().getMonth();
    const initialYear = latestDate ? latestDate.getFullYear() : new Date().getFullYear(); 
    const currentYear = new Date().getFullYear();
    
    if (filterContainer) {
        filterContainer.innerHTML = '';
        
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const monthSelect = document.createElement('select');
        monthSelect.id = 'month-filter';
        monthSelect.className = 'p-2 rounded-lg bg-white border border-gray-300 shadow-md focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition duration-150';
        monthNames.forEach((name, index) => {
            const option = document.createElement('option');
            option.value = index;
            option.textContent = name;
            if (index === initialMonth) option.selected = true; 
            monthSelect.appendChild(option);
        });
        
        const yearSelect = document.createElement('select');
        yearSelect.id = 'year-filter';
        yearSelect.className = 'p-2 rounded-lg bg-white border border-gray-300 shadow-md focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition duration-150 ml-2';
        for (let y = currentYear - 2; y <= currentYear + 1; y++) {
            const option = document.createElement('option');
            option.value = y;
            option.textContent = y;
            if (y === initialYear) option.selected = true; 
            yearSelect.appendChild(option);
        }
        
        filterContainer.appendChild(monthSelect);
        filterContainer.appendChild(yearSelect);

        renderedMonth = initialMonth;
        renderedYear = initialYear;

        monthSelect.addEventListener('change', updateMonthlyCharts);
        yearSelect.addEventListener('change', updateMonthlyCharts);
    }
}

function updateMonthlyCharts() {
    if (allData.length === 0) {
        // (จัดการ UI กรณีไม่มีข้อมูล)
        const gasNames = Object.keys(GAS_MONITORING_CONFIG);
        const chartContainer = document.getElementById('monthly-chart-container');
        if (isFirstLoad && chartContainer) {
            chartContainer.innerHTML = gasNames.map(gasName => {
                return `<div id="monthly-card-${getSafeId(gasName)}" class="card bg-white p-6 col-span-12 lg:col-span-6">
                        <p class="text-center text-gray-500 py-8 no-data-message">🚫 No data ${gasName} in Google Sheet</p>
                    </div>`;
            }).join('');
        }
        return;
    }
    
    const monthFilter = document.getElementById('month-filter');
    const yearFilter = document.getElementById('year-filter');
    
    if (!monthFilter || !yearFilter) return;

    const selectedMonth = parseInt(monthFilter.value, 10);
    const selectedYear = parseInt(yearFilter.value, 10);
    
    console.log(`Updating monthly charts for ${selectedMonth + 1}/${selectedYear}`);

    const monthlyData = prepareMonthlyData(allData, selectedMonth, selectedYear);
    const chartContainer = document.getElementById('monthly-chart-container');
    const gasNames = Object.keys(GAS_MONITORING_CONFIG);
    
    const filterChanged = selectedMonth !== renderedMonth || selectedYear !== renderedYear;

    if (filterChanged || isFirstLoad) {
        
        renderedMonth = selectedMonth;
        renderedYear = selectedYear;

        Object.values(lineCharts).forEach(chart => chart.destroy());
        lineCharts = {};

        if (chartContainer) {
            chartContainer.innerHTML = ''; 

            gasNames.forEach(gasName => {
                const data = monthlyData[gasName];
                const card = document.createElement('div');
                card.id = `monthly-card-${getSafeId(gasName)}`;
                card.className = 'card bg-white p-6 col-span-12 lg:col-span-6'; 
                
                const canvasId = `line-chart-${getSafeId(gasName)}`;
                const canvas = document.createElement('canvas');
                canvas.id = canvasId;
                
                chartContainer.appendChild(card);

                if (data && data.data.length > 0) { 
                    card.appendChild(canvas);
                    renderOrUpdateLineChart(gasName, canvasId, data);
                } else {
                    const noData = document.createElement('p');
                    noData.className = 'text-center text-gray-500 py-8 no-data-message';
                    noData.textContent = `🚫 No data ${gasName}`;
                    card.appendChild(noData);
                }
            });
        }

    } else {
        // *** นี่คือส่วนที่แก้ไขเพื่ออัปเดตชาร์ตเดิม (กรณีไม่ FirstLoad และ Filter ไม่เปลี่ยน) ***
        gasNames.forEach(gasName => {
            const data = monthlyData[gasName];
            const canvasId = `line-chart-${getSafeId(gasName)}`;
            const card = document.getElementById(`monthly-card-${getSafeId(gasName)}`);

            if (card) {
                const canvas = document.getElementById(canvasId);
                const noDataEl = card.querySelector('.no-data-message');

                if (data && data.data.length > 0) {
                    if (!canvas) {
                        // ถ้าไม่มี canvas (เพราะก่อนหน้าไม่มีข้อมูล) ให้สร้างใหม่
                        if (noDataEl) noDataEl.remove();
                        const newCanvas = document.createElement('canvas');
                        newCanvas.id = canvasId;
                        card.appendChild(newCanvas);
                        renderOrUpdateLineChart(gasName, canvasId, data); // สร้าง
                    } else {
                        // ถ้ามี canvas อยู่แล้ว ให้อัปเดต
                        renderOrUpdateLineChart(gasName, canvasId, data); // อัปเดต
                        if (noDataEl) noDataEl.style.display = 'none';
                    }
                } else {
                    // ถ้าไม่มีข้อมูล
                    if (canvas) canvas.remove(); // ลบ canvas เก่า
                    if (lineCharts[gasName]) { delete lineCharts[gasName]; } // ลบ instance
                    
                    if (!noDataEl) { // สร้างข้อความ "No data"
                        const newNoData = document.createElement('p');
                        newNoData.className = 'text-center text-gray-500 py-8 no-data-message';
                        card.appendChild(newNoData);
                    }
                    card.querySelector('.no-data-message').textContent = `🚫 No data ${gasName}`;
                    if (noDataEl) noDataEl.style.display = 'block';
                }
            }
        });
    }
}

// --- ฟังก์ชันสำหรับหน้า Report ---

/**
 * ดึง ID ของไฟล์จาก URL ของ Google Drive
 */
function extractFileIdFromUrl(url) {
    if (!url) return null;
    let fileId = null;
    
    // รูปแบบ: .../file/d/FILE_ID/...
    let match = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (match) {
        fileId = match[1];
    }
    
    // รูปแบบ: ...?id=FILE_ID...
    if (!fileId) {
        match = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
        if (match) {
            fileId = match[1];
        }
    }
    
    // รูปแบบ: .../uc?id=FILE_ID...
    if (!fileId) {
        match = url.match(/\/uc\?id=([a-zA-Z0-9_-]+)/);
        if (match) {
            fileId = match[1];
        }
    }

    return fileId;
}

/**
 * ตั้งค่าตัวกรองวันที่สำหรับหน้า Report (ครั้งแรก)
 */
function setupReportFilters() {
    const fromDateEl = document.getElementById('report-from-date');
    const toDateEl = document.getElementById('report-to-date');
    
    if (!fromDateEl || !toDateEl) return;

    const today = new Date();
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    // แปลงเป็น YYYY-MM-DD
    const toYYYYMMDD = (date) => date.toISOString().split('T')[0];

    fromDateEl.value = toYYYYMMDD(firstDayOfMonth);
    toDateEl.value = toYYYYMMDD(today);
}

/**
 * อัปเดตตาราง Report ตามตัวกรอง
 */
function updateReportTable() {
    const fromDateEl = document.getElementById('report-from-date');
    const toDateEl = document.getElementById('report-to-date');
    const tableContainer = document.getElementById('report-table-container');
    const tableBody = document.getElementById('report-table-body');
    const noDataMessage = document.getElementById('report-no-data');

    if (!fromDateEl || !toDateEl || !tableBody || !noDataMessage || !tableContainer) return;

    // 1. อ่านค่า
    const fromDate = new Date(fromDateEl.value);
    fromDate.setHours(0, 0, 0, 0);
    const toDate = new Date(toDateEl.value);
    toDate.setHours(23, 59, 59, 999); 

    // 2. กรองข้อมูล
    currentFilteredData = allData.filter(record => {
        const recordDate = record.DateTime;
        return recordDate >= fromDate && recordDate <= toDate;
    });
    
    // 3. Render ตาราง
    tableBody.innerHTML = '';
    
    if (currentFilteredData.length === 0) {
        noDataMessage.classList.remove('hidden');
        tableContainer.classList.add('hidden');
    } else {
        noDataMessage.classList.add('hidden');
        tableContainer.classList.remove('hidden');
        
        const locale = 'th-TH';
        const dateOptions = { day: '2-digit', month: '2-digit', year: 'numeric' };
        const timeOptions = { hour: '2-digit', minute: '2-digit' };

        currentFilteredData.forEach((record, index) => {
            const fileId = extractFileIdFromUrl(record.Image);
            const imageElementId = `report-image-${index}`; // สร้าง ID ที่ไม่ซ้ำกัน

            const formattedDate = record.DateTime.toLocaleDateString(locale, dateOptions);
            const formattedTime = record.DateTime.toLocaleTimeString(locale, timeOptions);

            const tr = document.createElement('tr');
            tr.className = 'border-b border-gray-200 hover:bg-gray-100';
            tr.innerHTML = `
                <td class="py-3 px-4 text-sm">${formattedDate} ${formattedTime} น.</td>
                <td class="py-3 px-4">${record['Gas Name'] || 'N/A'}</td>
                <td class="py-3 px-4 text-right">${record.Remain.toFixed(2)}</td>
                <td class="py-3 px-4 text-center">${record['Employee Name'] || 'N/A'}</td>
                <td class="py-3 px-4">
                    <div id="${imageElementId}" class="w-16 h-16 bg-gray-200 rounded-md shadow-sm animate-pulse flex items-center justify-center">
                        <svg class="animate-spin h-5 w-5 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                    </div>
                </td>
            `;
            tableBody.appendChild(tr);
            
            // หลังจาก Render แถวแล้ว ค่อยไปดึงรูปภาพแบบ Base64
            if (fileId) {
                loadReportImagesAfterRender(fileId, imageElementId);
            } else {
                // ถ้าไม่มี File ID ให้แสดง "N/A"
                const placeholder = document.getElementById(imageElementId);
                if(placeholder) {
                    placeholder.classList.remove('animate-pulse');
                    placeholder.innerHTML = '<span class="text-xs text-gray-500">N/A</span>';
                }
            }
        });
    }
}

/**
 * (ใหม่) โหลดรูปภาพ Base64 จาก GAS หลังจากที่ตาราง Render แล้ว
 */
async function loadReportImagesAfterRender(fileId, elementId) {
    try {
        const imageUrl = `${GAS_URL}?action=getImage&id=${fileId}`;
        const response = await fetch(imageUrl, { 
            method: 'GET', 
            cache: 'default', // ใช้ cache ได้
            redirect: 'follow',
            mode: 'cors'
        });
        
        if (!response.ok) throw new Error('Failed to fetch image data.');

        const imageData = await response.json();
        
        if (imageData.error) throw new Error(imageData.error);

        const placeholder = document.getElementById(elementId);
        if (placeholder && imageData.base64) {
            const imageUrlSrc = `data:${imageData.mimeType};base64,${imageData.base64}`;
            
            // สร้างแท็ก <img> ใหม่
            const img = document.createElement('img');
            img.src = imageUrlSrc;
            img.alt = "Record Image";
            img.className = "w-16 h-16 object-cover rounded-md shadow-sm";
            
            // --- [เพิ่ม 2 บรรทัดนี้] ---
            img.classList.add('cursor-pointer'); // 1. เปลี่ยนเมาส์เป็นรูปมือ
            img.addEventListener('click', () => openImageModal(imageUrlSrc)); // 2. สั่งให้คลิกแล้วเปิด Modal
            // --- [จบส่วนที่เพิ่ม] ---

            // แทนที่ Placeholder ด้วย <img>
            placeholder.parentNode.replaceChild(img, placeholder);
        }

    } catch (error) {
        console.error(`Error loading image (ID: ${fileId}):`, error);
        const placeholder = document.getElementById(elementId);
        if (placeholder) {
            // ถ้าโหลดล้มเหลว ให้แสดง "Error"
            placeholder.classList.remove('animate-pulse');
            placeholder.innerHTML = '<span class="text-xs text-red-500">Error</span>';
        }
    }
}

/**
 * [ใหม่] เปิด Modal เพื่อแสดงรูปภาพ
 */
function openImageModal(imageUrl) {
    const modal = document.getElementById('image-modal');
    const modalImage = document.getElementById('modal-image');
    
    if (modal && modalImage) {
        modalImage.src = imageUrl;
        modal.classList.remove('hidden'); // แสดง Modal
    }
}

/**
 * [ใหม่] ปิด Modal
 */
function closeImageModal() {
    const modal = document.getElementById('image-modal');
    if (modal) {
        modal.classList.add('hidden'); // ซ่อน Modal
        document.getElementById('modal-image').src = ""; // ล้างค่า src (กันแสดงภาพเก่าค้าง)
    }
}

/**
 * Export ข้อมูลที่กรองแล้วเป็น CSV
 */
function exportToCSV() {
    if (currentFilteredData.length === 0) {
        // (สามารถเพิ่มการแจ้งเตือน UI ที่นี่ได้)
        console.log("No data to export.");
        return;
    }

    const headers = ["Date", "Time", "Gas Name", "Remain", "Employee Name", "Image URL"];
    
    const locale = 'th-TH';
    const dateOptions = { year: 'numeric', month: '2-digit', day: '2-digit' };
    const timeOptions = { hour: '2-digit', minute: '2-digit', second: '2-digit' };

    // แปลงข้อมูล
    const rows = currentFilteredData.map(record => {
        const date = record.DateTime.toLocaleDateString(locale, dateOptions);
        const time = record.DateTime.toLocaleTimeString(locale, timeOptions);
        
        // ใช้ค่าดิบ (raw value) จาก record
        const gas = `"${record['Gas Name'] || ''}"`;
        const remain = record.Remain;
        const employee = `"${record['Employee Name'] || ''}"`;
        const image = `"${record.Image || ''}"`;
        
        return [date, time, gas, remain, employee, image].join(',');
    });

    // สร้างเนื้อหา CSV
    const csvContent = [
        headers.join(','), // แถวหัวข้อ
        ...rows // แถวข้อมูล
    ].join('\n');

    // [แก้ไข] 1. เพิ่ม BOM (Byte Order Mark) เพื่อให้ Excel อ่านภาษาไทยออก
    const bom = '\uFEFF'; 
    
    // [แก้ไข] 2. แก้ charset เป็น utf-8 และเพิ่ม bom เข้าไปข้างหน้า csvContent
    const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' });
    
    // สร้างลิงก์ดาวน์โหลด
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    const today = new Date().toISOString().split('T')[0];
    link.setAttribute('href', url);
    link.setAttribute('download', `report_export_${today}.csv`);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// --- ฟังก์ชันควบคุมการสลับหน้า ---

/**
 * สลับการแสดงผลระหว่าง Dashboard และ Report
 */
function switchView(viewName, activeLinkId) {

    // --- [ ⬇️ เพิ่มโค้ดส่วนนี้ ⬇️ ] ---
    // 1. ดึงหัวข้อหลัก
    const mainHeading = document.getElementById('main-heading');

    // 2. เปลี่ยนข้อความตาม viewName
    if (mainHeading) {
        if (viewName === 'home') {
            mainHeading.textContent = "Chemical Monitoring System";
        } else if (viewName === 'dashboard') {
            mainHeading.textContent = "Chemical Monitoring Dashboard";
        } else if (viewName === 'report') {
            mainHeading.textContent = "Chemical Monitoring Report";
        }
    }
    // --- [ ⬆️ จบส่วนที่เพิ่ม ⬆️ ] ---


    // 3. ดึง View ทั้งหมด
    const homeView = document.getElementById('home-view');
    const dashboardView = document.getElementById('dashboard-view');
    const reportView = document.getElementById('report-view');
    
    // 4. จัดการ Sidebar link active/inactive
    const allLinks = [
        document.getElementById('link-home'),
        document.getElementById('link-dashboard'),
        document.getElementById('link-report')
    ];

    allLinks.forEach(link => {
        if (link && link.id === activeLinkId) {
            // ทำให้ลิงก์ที่ถูกคลิก active
            link.className = link.className.replace('sidebar-link-inactive', 'sidebar-link-active');
        } else if (link) {
            // ทำให้ลิงก์อื่น inactive
            link.className = link.className.replace('sidebar-link-active', 'sidebar-link-inactive');
        }
    });
    
    // 5. ซ่อนทั้งหมดก่อน
    if (homeView) homeView.classList.add('view-hidden');
    if (dashboardView) dashboardView.classList.add('view-hidden');
    if (reportView) reportView.classList.add('view-hidden');

    // 6. เปิดเฉพาะ View ที่เลือก
    if (viewName === 'home' && homeView) {
        homeView.classList.remove('view-hidden');
    } else if (viewName === 'dashboard' && dashboardView) {
        dashboardView.classList.remove('view-hidden');

        setTimeout(() => {
            updateMonthlyCharts();
        }, 50);

    } else if (viewName === 'report' && reportView) {
        reportView.classList.remove('view-hidden');
    }
}


// --- ฟังก์ชันหลักที่รันตอนเริ่ม ---

/**
 * ฟังก์ชันหลักในการดึงข้อมูลและอัปเดต Dashboard
 */
async function updateDashboardData() {
    const loadingStatus = document.getElementById('loading-status');
    if (loadingStatus) {
        loadingStatus.textContent = 'Loading... 🔄';
    }
    
    try {
        await fetchDataFromGoogleSheet();
        // ถ้าสำเร็จ (ข้อมูลอยู่ใน allData)
        if (loadingStatus) {
            loadingStatus.textContent = `Latest update: ${new Date().toLocaleTimeString('th-TH')}`;
        }
        
    } catch (e) {
        // ถ้าล้มเหลว (allData จะเป็น Array ว่างเปล่า)
        console.error("Failed to fetch data, proceeding with empty dataset.");
        if (loadingStatus) {
            loadingStatus.textContent = '⚠️ Load data failed.';
        }
    }

    // --- แก้ไข: ย้ายส่วนที่สร้าง UI ออกมาข้างนอก ---
    // ไม่ว่า fetch จะสำเร็จหรือล้มเหลว เราจะพยายาม Render UI เสมอ
    // (ฟังก์ชันต่างๆ ถูกออกแบบให้รองรับ allData ที่ว่างเปล่าได้)

    // 1. อัปเดต Dashboard (Gauge + Line)
    updateDailyCharts();
    
    if (isFirstLoad) {
        const latestDate = allData.length > 0 ? allData[0].DateTime : null;
        setupFilters(latestDate);
    }
    
    updateMonthlyCharts(); 

    // 2. อัปเดต Report (Table)
    if (isFirstLoad) {
        setupReportFilters();
    }
    updateReportTable(); // (จะแสดง "No data" ถ้า allData ว่าง)

    isFirstLoad = false;
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const mainContent = document.getElementById('main-content'); // ดึง main-content
    const isOpen = sidebar.classList.contains('sidebar-open');
    
    if (isOpen) {
        // --- ปิด Sidebar ---
        sidebar.classList.remove('sidebar-open');
        sidebar.classList.add('sidebar-closed');
        overlay.classList.add('hidden'); // ซ่อน Overlay (สำหรับมือถือ)
        
        // [แก้ไข] ลบ margin lg:ml-64 ออกจาก main-content
        if (mainContent) {
            mainContent.classList.remove('lg:ml-64');
        }

    } else {
        // --- เปิด Sidebar ---
        sidebar.classList.remove('sidebar-closed');
        sidebar.classList.add('sidebar-open');
        overlay.classList.remove('hidden'); // แสดง Overlay (สำหรับมือถือ)
        
        // [แก้ไข] เพิ่ม margin lg:ml-64 ให้ main-content
        if (mainContent) {
            mainContent.classList.add('lg:ml-64');
        }
    }
}

// --- [เพิ่ม] ส่วนที่ 1: ฟังก์ชันแสดง/ซ่อนหน้า ---

function showLoginScreen() {

    // นี่คือจุด "หยุด" Timer ทั้งหมด
    // ไม่ว่าจะเป็นการ Logout เอง, หมดเวลา, หรือถูกเตะ
    console.log("Showing login screen, stopping all session timers.");
    stopInactivityMonitor();
    stopAbsoluteTimer();

    // Show/Hide divs
    document.getElementById('login-view').classList.remove('login-hidden');
    document.getElementById('sidebar').classList.add('hidden');
    document.getElementById('main-content').classList.add('hidden');

    // [แก้ไข] 1. ล้างค่าในช่องกรอก
    const emailInput = document.getElementById('login-email');
    const passwordInput = document.getElementById('login-password');
    const loginError = document.getElementById('login-error');

    if (emailInput) emailInput.value = "";
    if (passwordInput) passwordInput.value = "";
    if (loginError) loginError.textContent = "";
}

function showApp() {
    document.getElementById('login-view').classList.add('login-hidden');
    
    const sidebar = document.getElementById('sidebar');
    const mainContent = document.getElementById('main-content');

    // [แก้ไข] บังคับสถานะ "ปิด" เมื่อแอปเริ่ม
    sidebar.classList.remove('hidden');
    sidebar.classList.remove('sidebar-open'); // ลบสถานะ "เปิด" (ถ้ามี)
    sidebar.classList.add('sidebar-closed');  // เพิ่มสถานะ "ปิด"
    
    mainContent.classList.remove('hidden');
    mainContent.classList.remove('lg:ml-64'); // ลบ margin (บังคับให้เต็มจอ)

    // --- [ ⬇️ เพิ่มบรรทัดนี้ ⬇️ ] ---
    // บังคับซ่อน overlay เพื่อรีเซ็ตสถานะ
    document.getElementById('sidebar-overlay').classList.add('hidden');

    // [แก้ไข] เรียกใช้ initializeAppLogic() ที่นี่
    initializeAppLogic();
}


// --- [เพิ่ม] ส่วนที่ 2: "ยาม" คอยตรวจสอบสถานะ Login ---
// (วางไว้นอก window.onload)
firebase.auth().onAuthStateChanged((user) => {
    if (user) {
        // ผู้ใช้ล็อกอินอยู่
        showApp();
    } else {
        // ผู้ใช้ไม่ได้ล็อกอิน
        showLoginScreen();
    }
});


// --- [แก้ไข] ส่วนที่ 3: โค้ดเดิมของคุณ (ย้ายเข้ามาในฟังก์ชันใหม่) ---

// โค้ด *ทั้งหมด* ที่เคยอยู่ใน window.onload เดิม จะย้ายมาที่นี่
function initializeAppLogic() {
    
    // 1. เริ่มตัวจับเวลา 30 นาที (เมื่อไม่ใช้งาน)
    console.log("Starting inactivity monitor...");
    startInactivityMonitor();

    // 2. เริ่มตัวจับเวลา 8 ชั่วโมง (หมดอายุแน่นอน)
    if (!absoluteTimer) { // ป้องกันการเริ่มซ้ำ
        console.log("Starting absolute session timer (8 hours)...");
        absoluteTimer = setTimeout(handleAbsoluteTimeout, ABSOLUTE_TIMEOUT_MS);
    }
    
    // บังคับให้กลับไปหน้า Home ทุกครั้งที่ Login สำเร็จ
    switchView('home', 'link-home'); 
    
    Chart.register(ChartDataLabels);
    
    // Sidebar toggles (เหมือนเดิม)
    document.getElementById('hamburger-btn').addEventListener('click', toggleSidebar);
    document.getElementById('close-sidebar-btn').addEventListener('click', toggleSidebar);
    document.getElementById('sidebar-overlay').addEventListener('click', toggleSidebar);

    // Page View Switching (เหมือนเดิม)
    const linkHome = document.getElementById('link-home');
    if (linkHome) {
        linkHome.addEventListener('click', (e) => {
            e.preventDefault();
            switchView('home', 'link-home'); 
            if (window.innerWidth < 1024) toggleSidebar();
        });
    }
    const linkDashboard = document.getElementById('link-dashboard');
    if (linkDashboard) {
        linkDashboard.addEventListener('click', (e) => {
            e.preventDefault();
            switchView('dashboard', 'link-dashboard'); 
            if (window.innerWidth < 1024) toggleSidebar(); 
        });
    }
    const linkReport = document.getElementById('link-report');
    if (linkReport) {
        linkReport.addEventListener('click', (e) => {
            e.preventDefault();
            switchView('report', 'link-report'); 
            if (window.innerWidth < 1024) toggleSidebar(); 
        });
    }

    // Card Clicks (เหมือนเดิม)
    const cardDashboard = document.getElementById('card-link-dashboard');
    if (cardDashboard) {
        cardDashboard.addEventListener('click', () => {
            switchView('dashboard', 'link-dashboard');
        });
    }
    const cardReport = document.getElementById('card-link-report');
    if (cardReport) {
        cardReport.addEventListener('click', () => {
            switchView('report', 'link-report');
        });
    }

    // Back Buttons (เหมือนเดิม)
    const btnBackDash = document.getElementById('back-to-home-from-dash');
    if (btnBackDash) {
        btnBackDash.addEventListener('click', () => {
            switchView('home', 'link-home');
        });
    }
    const btnBackReport = document.getElementById('back-to-home-from-report');
    if (btnBackReport) {
        btnBackReport.addEventListener('click', () => {
            switchView('home', 'link-home');
        });
    }

    // Modal Clicks (เหมือนเดิม)
    const modalCloseBtn = document.getElementById('modal-close-btn');
    if (modalCloseBtn) {
        modalCloseBtn.addEventListener('click', closeImageModal);
    }
    const imageModal = document.getElementById('image-modal');
    if (imageModal) {
        imageModal.addEventListener('click', (e) => {
            if (e.target.id === 'image-modal') {
                closeImageModal();
            }
        });
    }

    // Report Listeners (เหมือนเดิม)
    document.getElementById('report-from-date').addEventListener('change', updateReportTable);
    document.getElementById('report-to-date').addEventListener('change', updateReportTable);
    document.getElementById('export-csv-btn').addEventListener('click', exportToCSV);

    // [เพิ่ม] ปุ่ม Logout
    const linkLogout = document.getElementById('link-logout'); 
    if (linkLogout) {
        linkLogout.addEventListener('click', (e) => {
            e.preventDefault();
            firebase.auth().signOut(); // สั่ง Logout
        });
    }

    // Initial Load (เหมือนเดิม)
    // [แก้ไข] ตรวจสอบ isFirstLoad ก่อนโหลดข้อมูล
    if (isFirstLoad) {
        updateDashboardData(); // โหลดข้อมูลครั้งแรก
        setInterval(updateDashboardData, 30000); // อัปเดตทุก 30 วินาที
    }
}

// --- [แก้ไข] window.onload จะเหลือแค่โค้ดสำหรับหน้า Login ---
window.onload = function() {
    const loginButton = document.getElementById('login-button');
    const emailInput = document.getElementById('login-email');
    const passwordInput = document.getElementById('login-password');
    const loginError = document.getElementById('login-error');
    
    // [เพิ่ม] 1. ดึงปุ่มใหม่
    const forgotPasswordButton = document.getElementById('forgot-password-button');

    // --- ⬇️ [เพิ่มโค้ดส่วนนี้] ⬇️ ---
    // สั่งให้ Firebase "ลืม" การล็อกอิน เมื่อปิดบราวเซอร์
    // ต้องเรียก *ก่อน* ที่จะพยายามล็อกอิน
    firebase.auth().setPersistence(firebase.auth.Auth.Persistence.SESSION)
      .catch((error) => {
        // (เผื่อไว้ในกรณีที่เกิด Error)
        console.error("Firebase persistence error:", error.code, error.message);
      });
    // --- ⬆️ [จบส่วนที่เพิ่ม] ⬆️ ---
    

    // โค้ดสำหรับปุ่ม Login
    if (loginButton) {
        loginButton.addEventListener('click', () => {
            const email = emailInput.value;
            const password = passwordInput.value;
            loginError.innerHTML = `<svg class="animate-spin h-5 w-5 text-teal-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>`;
            loginError.classList.remove('text-green-500');
            loginError.classList.remove('text-red-500'); // ไม่ต้องเป็นสีแดงตอนโหลด

            firebase.auth().signInWithEmailAndPassword(email, password)
                .then((userCredential) => {
                    // สำเร็จ! (ตัว "ยาม" onAuthStateChanged จะจัดการต่อ)
                })
                .catch((error) => {
                    loginError.innerHTML = ""; // [เพิ่ม] 1. ล้างไอคอน Spinner ทิ้ง
                    loginError.classList.add('text-red-500'); // [เพิ่ม] 2. คืนค่าสีแดงสำหรับ Error
                    console.error("Login Error:", error);
                         if (error.code === 'auth/wrong-password' || error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential') {
                                loginError.textContent = "อีเมลหรือรหัสผ่านไม่ถูกต้อง";
                        } else {
                             loginError.textContent = "อีเมลหรือรหัสผ่านไม่ถูกต้อง";
                                }       
                    });
        });
    }

    // [เพิ่ม] 2. โค้ดสำหรับปุ่ม "ลืมรหัสผ่าน"
    if (forgotPasswordButton) {
        forgotPasswordButton.addEventListener('click', (e) => {
            e.preventDefault(); // กันหน้าเว็บรีเฟรช
            const email = emailInput.value;
            
            // เช็กว่ากรอกอีเมลหรือยัง
            if (!email) {
                loginError.innerHTML = "";
                loginError.textContent = "กรุณาป้อนอีเมลของคุณในช่องด้านบน";
                loginError.classList.remove('text-green-500');
                loginError.classList.add('text-red-500');
                return;
            }
            
            loginError.innerHTML = "";
            loginError.textContent = "กำลังส่งลิงก์รีเซ็ต...";
            loginError.classList.remove('text-red-500');
            loginError.classList.add('text-green-500'); // ใช้สีเขียวสำหรับข้อความแจ้งเตือน

            // สั่ง Firebase ให้ส่งอีเมลรีเซ็ต
            firebase.auth().sendPasswordResetEmail(email)
                .then(() => {
                    // ส่งสำเร็จ
                    loginError.innerHTML = "";
                    loginError.textContent = "ส่งลิงก์รีเซ็ตรหัสผ่านแล้ว! กรุณาตรวจสอบอีเมล";
                    loginError.classList.remove('text-red-500');
                    loginError.classList.add('text-green-500');
                })
                .catch((error) => {
                    // ส่งไม่สำเร็จ
                    loginError.innerHTML = "";
                    loginError.classList.remove('text-green-500');
                    loginError.classList.add('text-red-500');
                    if (error.code === 'auth/user-not-found') {
                        loginError.textContent = "ไม่พบผู้ใช้ที่ใช้อีเมลนี้";
                    } else {
                        loginError.textContent = `เกิดข้อผิดพลาด: ${error.message}`;
                    }
                });
        });
    }
}
