const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());

const API_URL = "https://wtxmd52.tele68.com/v1/txmd5/lite-sessions?cp=R&cl=R&pf=web&at=3959701241b686f12e01bfe9c3a319b8";
const MAX_HISTORY = 50;

/* ===========================
    HÀM TÍNH TÀI/XỈU
==========================*/
function getTaiXiu(d1, d2, d3) {
  const total = d1 + d2 + d3;
  return total <= 10 ? "Xỉu" : "Tài";
}

/*===========================
    TÍNH ĐỘ TIN CẬY - CẢI TIẾN
===========================*/
function calculateConfidence(history, prediction, last_n = 12) {
  if (history.length < 4) return 0;

  let correct = 0;
  let total = 0;

  const recent = history.slice(0, Math.min(last_n, history.length - 1));

  for (let i = 0; i < recent.length - 1; i++) {
    if (i + 3 >= history.length) break;
    
    const historySlice = history.slice(i);
    const predict = duDoanNangCao(historySlice, last_n);
    
    if (predict && predict === history[i + 1]?.ket_qua) {
      correct++;
    }
    total++;
  }

  const baseConfidence = total > 0 ? (correct / total) * 100 : 0;
  const dataBonus = Math.min(history.length / 50 * 10, 10);
  
  return Math.round(Math.min(baseConfidence + dataBonus, 100));
}

/*===========================
    HÀM PHÂN TÍCH MARKOV
===========================*/
function analyzeMarkov(seq, order) {
  const transitions = {};
  const counts = { Tài: 0, Xỉu: 0 };

  for (let i = 0; i < seq.length - order; i++) {
    const key = seq.slice(i, i + order).join("-");
    const next = seq[i + order];
    
    if (!transitions[key]) {
      transitions[key] = { Tài: 0, Xỉu: 0 };
    }
    transitions[key][next]++;
  }

  const lastState = seq.slice(0, order).join("-");
  if (transitions[lastState]) {
    const { Tài, Xỉu } = transitions[lastState];
    const total = Tài + Xỉu;
    
    if (total > 0) {
      counts.Tài = Tài / total;
      counts.Xỉu = Xỉu / total;
    }
  }

  return counts;
}

/*===========================
    HÀM PHÂN TÍCH PATTERN
===========================*/
function analyzePatterns(seq) {
  const scores = { Tài: 0, Xỉu: 0 };
  const patternLength = 3;
  
  if (seq.length < patternLength + 2) {
    return { Tài: 0.5, Xỉu: 0.5 };
  }

  const currentPattern = seq.slice(0, patternLength).join("");
  let taiMatches = 0;
  let xiuMatches = 0;
  let totalMatches = 0;

  for (let i = patternLength; i < seq.length - 1; i++) {
    const testPattern = seq.slice(i - patternLength, i).join("");
    
    if (testPattern === currentPattern) {
      const next = seq[i];
      if (next === "Tài") taiMatches++;
      else if (next === "Xỉu") xiuMatches++;
      totalMatches++;
    }
  }

  if (totalMatches > 0) {
    scores.Tài = taiMatches / totalMatches;
    scores.Xỉu = xiuMatches / totalMatches;
  }

  return scores;
}

/*===========================
    PHÂN TÍCH TỔNG ĐIỂM
===========================*/
function analyzeTong(tongSeq) {
  if (tongSeq.length < 3) return { Tài: 0.5, Xỉu: 0.5 };

  const scores = { Tài: 0, Xỉu: 0 };
  const recentAvg = tongSeq.reduce((a, b) => a + b, 0) / tongSeq.length;
  
  let increasing = 0;
  let decreasing = 0;
  
  for (let i = 1; i < tongSeq.length; i++) {
    if (tongSeq[i] > tongSeq[i-1]) increasing++;
    else if (tongSeq[i] < tongSeq[i-1]) decreasing++;
  }

  if (increasing > decreasing) {
    scores.Tài = 0.7;
    scores.Xỉu = 0.3;
  } else if (decreasing > increasing) {
    scores.Tài = 0.3;
    scores.Xỉu = 0.7;
  } else {
    scores.Tài = recentAvg > 10.5 ? 0.6 : 0.4;
    scores.Xỉu = 1 - scores.Tài;
  }

  return scores;
}

/*===========================
    PHÂN TÍCH CHU KỲ
===========================*/
function analyzeCycles(seq) {
  if (seq.length < 6) return { Tài: 0.5, Xỉu: 0.5 };

  const scores = { Tài: 0, Xỉu: 0 };
  const maxCycleLength = Math.min(10, Math.floor(seq.length / 2));
  
  let bestCycle = 0;
  let bestCorrelation = 0;

  for (let cycle = 2; cycle <= maxCycleLength; cycle++) {
    let matches = 0;
    let total = 0;
    
    for (let i = 0; i < seq.length - cycle; i++) {
      if (seq[i] === seq[i + cycle]) {
        matches++;
      }
      total++;
    }
    
    const correlation = matches / total;
    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestCycle = cycle;
    }
  }

  if (bestCycle > 0 && bestCorrelation > 0.6) {
    const predicted = seq[seq.length - bestCycle];
    if (predicted === "Tài") {
      scores.Tài = 0.8;
      scores.Xỉu = 0.2;
    } else {
      scores.Tài = 0.2;
      scores.Xỉu = 0.8;
    }
  }

  return scores;
}

/*===========================
    BẢNG TRA MD5 & XÚC XẮC
===========================*/
const MD5_TIPS = {
  3: { result: "Xỉu", confidence: 70 }, 4: { result: "Xỉu", confidence: 60 },
  5: { result: "Tài", confidence: 70 }, 6: { result: "Xỉu", confidence: 60 },
  7: { result: "Tài", confidence: 80 }, 8: { result: "Xỉu", confidence: 80 },
  9: { result: "Xỉu", confidence: 70 }, 10: { result: "Tài", confidence: 80 },
  11: { result: "Xỉu", confidence: 60 }, 12: { result: "Tài", confidence: 80 },
  13: { result: "Tài", confidence: 80 }, 14: { result: "Xỉu", confidence: 60 },
  15: { result: "Xỉu", confidence: 70 }, 16: { result: "Tài", confidence: 60 },
  17: { result: "Xỉu", confidence: 60 }, 18: { result: "Xỉu", confidence: 80 },
};

const DICE_TABLE = {
  3:  { "111": { result: "Xỉu", confidence: 80 } },
  4:  { "112": { result: "Xỉu", confidence: 70 }, "121": { result: "Tài", confidence: 65 }, "211": { result: "Tài", confidence: 65 } },
  5:  { "113": { result: "Tài", confidence: 65 }, "122": { result: "Xỉu", confidence: 70 }, "131": { result: "Tài", confidence: 70 }, "212": { result: "Xỉu", confidence: 70 }, "221": { result: "Tài", confidence: 60 }, "311": { result: "Xỉu", confidence: 65 } },
  6:  { "114": { result: "Tài", confidence: 60 }, "123": { result: "Tài", confidence: 65 }, "132": { result: "Xỉu", confidence: 60 }, "141": { result: "Tài", confidence: 60 }, "213": { result: "Tài", confidence: 65 }, "222": { result: "Xỉu", confidence: 75 }, "231": { result: "Tài", confidence: 60 }, "312": { result: "Xỉu", confidence: 60 }, "411": { result: "Xỉu", confidence: 70 } },
  7:  { "115": { result: "Xỉu", confidence: 65 }, "124": { result: "Tài", confidence: 65 }, "133": { result: "Tài", confidence: 65 }, "142": { result: "Xỉu", confidence: 60 }, "151": { result: "Xỉu", confidence: 65 }, "214": { result: "Xỉu", confidence: 65 }, "223": { result: "Xỉu", confidence: 70 }, "232": { result: "Xỉu", confidence: 70 }, "241": { result: "Xỉu", confidence: 60 }, "313": { result: "Tài", confidence: 65 }, "322": { result: "Xỉu", confidence: 60 }, "331": { result: "Tài", confidence: 89 }, "412": { result: "Xỉu", confidence: 60 }, "511": { result: "Xỉu", confidence: 65 } },
  8:  { "116": { result: "Xỉu", confidence: 65 }, "125": { result: "Xỉu", confidence: 65 }, "134": { result: "Tài", confidence: 60 }, "143": { result: "Xỉu", confidence: 60 }, "152": { result: "Tài", confidence: 65 }, "161": { result: "Tài", confidence: 60 }, "215": { result: "Xỉu", confidence: 60 }, "224": { result: "Tài", confidence: 65 }, "233": { result: "Xỉu", confidence: 60 }, "242": { result: "Tài", confidence: 60 }, "251": { result: "Xỉu", confidence: 65 }, "314": { result: "Tài", confidence: 60 }, "323": { result: "Tài", confidence: 60 }, "332": { result: "Tài", confidence: 60 }, "341": { result: "Xỉu", confidence: 60 }, "413": { result: "Xỉu", confidence: 65 }, "422": { result: "Tài", confidence: 60 }, "431": { result: "Xỉu", confidence: 65 }, "512": { result: "Xỉu", confidence: 65 }, "521": { result: "Xỉu", confidence: 65 }, "611": { result: "Xỉu", confidence: 65 } },
  9:  { "126": { result: "Tài", confidence: 60 }, "135": { result: "Tài", confidence: 65 }, "144": { result: "Tài", confidence: 60 }, "153": { result: "Xỉu", confidence: 65 }, "162": { result: "Tài", confidence: 60 }, "216": { result: "Xỉu", confidence: 60 }, "225": { result: "Xỉu", confidence: 60 }, "234": { result: "Xỉu", confidence: 60 }, "243": { result: "Tài", confidence: 60 }, "252": { result: "Xỉu", confidence: 60 }, "261": { result: "Xỉu", confidence: 60 }, "315": { result: "Xỉu", confidence: 60 }, "324": { result: "Xỉu", confidence: 60 }, "333": { result: "Tài", confidence: 70 }, "342": { result: "Xỉu", confidence: 60 }, "351": { result: "Tài", confidence: 65 }, "414": { result: "Tài", confidence: 60 }, "423": { result: "Xỉu", confidence: 65 }, "432": { result: "Xỉu", confidence: 65 }, "441": { result: "Tài", confidence: 60 }, "513": { result: "Xỉu", confidence: 60 }, "522": { result: "Xỉu", confidence: 65 }, "531": { result: "Tài", confidence: 65 }, "612": { result: "Xỉu", confidence: 60 }, "621": { result: "Tài", confidence: 60 } },
  10: { "136": { result: "Tài", confidence: 65 }, "145": { result: "Tài", confidence: 60 }, "154": { result: "Tài", confidence: 60 }, "163": { result: "Xỉu", confidence: 65 }, "226": { result: "Xỉu", confidence: 60 }, "235": { result: "Xỉu", confidence: 60 }, "244": { result: "Tài", confidence: 65 }, "253": { result: "Xỉu", confidence: 60 }, "262": { result: "Tài", confidence: 60 }, "316": { result: "Xỉu", confidence: 60 }, "325": { result: "Xỉu", confidence: 65 }, "334": { result: "Xỉu", confidence: 60 }, "343": { result: "Tài", confidence: 60 }, "352": { result: "Xỉu", confidence: 60 }, "361": { result: "Tài", confidence: 60 }, "415": { result: "Tài", confidence: 60 }, "424": { result: "Xỉu", confidence: 65 }, "433": { result: "Tài", confidence: 60 }, "442": { result: "Xỉu", confidence: 60 }, "451": { result: "Xỉu", confidence: 60 }, "514": { result: "Xỉu", confidence: 60 }, "523": { result: "Xỉu", confidence: 60 }, "532": { result: "Xỉu", confidence: 60 }, "541": { result: "Xỉu", confidence: 60 }, "613": { result: "Xỉu", confidence: 60 }, "622": { result: "Tài", confidence: 60 }, "631": { result: "Tài", confidence: 60 } },
  11: { "146": { result: "Xỉu", confidence: 65 }, "155": { result: "Tài", confidence: 60 }, "164": { result: "Xỉu", confidence: 60 }, "236": { result: "Tài", confidence: 60 }, "245": { result: "Xỉu", confidence: 65 }, "254": { result: "Xỉu", confidence: 60 }, "263": { result: "Xỉu", confidence: 60 }, "326": { result: "Xỉu", confidence: 60 }, "335": { result: "Tài", confidence: 65 }, "344": { result: "Tài", confidence: 60 }, "353": { result: "Xỉu", confidence: 60 }, "362": { result: "Tài", confidence: 60 }, "416": { result: "Tài", confidence: 60 }, "425": { result: "Xỉu", confidence: 65 }, "434": { result: "Tài", confidence: 60 }, "443": { result: "Xỉu", confidence: 60 }, "452": { result: "Xỉu", confidence: 60 }, "461": { result: "Xỉu", confidence: 60 }, "515": { result: "Xỉu", confidence: 60 }, "524": { result: "Tài", confidence: 60 }, "533": { result: "Xỉu", confidence: 60 }, "542": { result: "Tài", confidence: 60 }, "551": { result: "Tài", confidence: 60 }, "614": { result: "Xỉu", confidence: 60 }, "623": { result: "Xỉu", confidence: 60 }, "632": { result: "Xỉu", confidence: 60 }, "641": { result: "Xỉu", confidence: 60 } },
  12: { "156": { result: "Tài", confidence: 60 }, "165": { result: "Tài", confidence: 60 }, "246": { result: "Xỉu", confidence: 60 }, "255": { result: "Tài", confidence: 60 }, "264": { result: "Xỉu", confidence: 60 }, "336": { result: "Tài", confidence: 60 }, "345": { result: "Tài", confidence: 60 }, "354": { result: "Tài", confidence: 60 }, "363": { result: "Tài", confidence: 60 }, "426": { result: "Tài", confidence: 60 }, "435": { result: "Tài", confidence: 60 }, "444": { result: "Xỉu", confidence: 65 }, "453": { result: "Tài", confidence: 60 }, "462": { result: "Xỉu", confidence: 60 }, "516": { result: "Tài", confidence: 60 }, "525": { result: "Tài", confidence: 60 }, "534": { result: "Xỉu", confidence: 60 }, "543": { result: "Tài", confidence: 60 }, "552": { result: "Tài", confidence: 60 }, "561": { result: "Tài", confidence: 60 }, "615": { result: "Tài", confidence: 60 }, "624": { result: "Tài", confidence: 60 }, "633": { result: "Tài", confidence: 60 }, "642": { result: "Xỉu", confidence: 60 }, "651": { result: "Tài", confidence: 60 } },
  13: { "166": { result: "Xỉu", confidence: 60 }, "256": { result: "Xỉu", confidence: 60 }, "265": { result: "Xỉu", confidence: 60 }, "346": { result: "Tài", confidence: 60 }, "355": { result: "Tài", confidence: 65 }, "364": { result: "Tài", confidence: 60 }, "436": { result: "Xỉu", confidence: 60 }, "445": { result: "Tài", confidence: 65 }, "454": { result: "Xỉu", confidence: 60 }, "463": { result: "Tài", confidence: 60 }, "526": { result: "Xỉu", confidence: 65 }, "535": { result: "Tài", confidence: 60 }, "544": { result: "Xỉu", confidence: 60 }, "553": { result: "Tài", confidence: 60 }, "562": { result: "Tài", confidence: 60 }, "616": { result: "Xỉu", confidence: 65 }, "625": { result: "Tài", confidence: 60 }, "634": { result: "Xỉu", confidence: 60 }, "643": { result: "Tài", confidence: 60 }, "652": { result: "Tài", confidence: 60 } },
  14: { "266": { result: "Xỉu", confidence: 60 }, "356": { result: "Tài", confidence: 65 }, "365": { result: "Xỉu", confidence: 60 }, "446": { result: "Xỉu", confidence: 60 }, "455": { result: "Tài", confidence: 65 }, "464": { result: "Tài", confidence: 60 }, "536": { result: "Xỉu", confidence: 60 }, "545": { result: "Tài", confidence: 65 }, "554": { result: "Xỉu", confidence: 60 }, "563": { result: "Tài", confidence: 60 }, "626": { result: "Xỉu", confidence: 65 }, "635": { result: "Tài", confidence: 60 }, "644": { result: "Xỉu", confidence: 60 }, "653": { result: "Tài", confidence: 60 } },
  15: { "366": { result: "Xỉu", confidence: 65 }, "456": { result: "Tài", confidence: 60 }, "465": { result: "Xỉu", confidence: 65 }, "546": { result: "Tài", confidence: 60 }, "555": { result: "Tài", confidence: 70 }, "564": { result: "Tài", confidence: 60 }, "636": { result: "Xỉu", confidence: 65 }, "645": { result: "Tài", confidence: 60 }, "654": { result: "Xỉu", confidence: 60 }, "663": { result: "Tài", confidence: 60 } },
  16: { "466": { result: "Xỉu", confidence: 65 }, "556": { result: "Xỉu", confidence: 60 }, "565": { result: "Xỉu", confidence: 65 }, "646": { result: "Tài", confidence: 60 }, "655": { result: "Xỉu", confidence: 70 }, "664": { result: "Tài", confidence: 60 } },
  17: { "566": { result: "Tài", confidence: 60 }, "656": { result: "Tài", confidence: 60 }, "665": { result: "Xỉu", confidence: 65 } },
  18: { "666": { result: "BỎ", confidence: 0 } },
};

/*===========================
    THUẬT TOÁN DỰ ĐOÁN NÂNG CAO
===========================*/
function duDoanNangCao(historyData, last_n = 15) {
  if (!historyData || historyData.length < 4) return "Chưa có dữ liệu";

  // Chuyển đổi format API sang format gốc
  const history = historyData.map(item => ({
    ket_qua: item.resultTruyenThong === "TAI" ? "Tài" : "Xỉu",
    tong: item.point,
    x1: item.dices[0], x2: item.dices[1], x3: item.dices[2]
  }));

  const seq = history.map(h => h.ket_qua);
  const tongSeq = history.map(h => h.tong);
  const recent = seq.slice(0, Math.min(last_n, seq.length));
  const recentTong = tongSeq.slice(0, Math.min(last_n, tongSeq.length));

  // 1. PHÂN TÍCH TẦN SUẤT
  const tai_count = recent.filter(s => s === "Tài").length;
  const xiu_count = recent.filter(s => s === "Xỉu").length;
  const frequency_score = {
    Tài: tai_count / recent.length,
    Xỉu: xiu_count / recent.length
  };

  // 2. MARKOV CHAIN BẬC 2 & 3
  const markov2 = analyzeMarkov(seq, 2);
  const markov3 = analyzeMarkov(seq, 3);
  const markov_score = {
    Tài: (markov2.Tài * 0.4 + markov3.Tài * 0.6),
    Xỉu: (markov2.Xỉu * 0.4 + markov3.Xỉu * 0.6)
  };

  // 3. PATTERN RECOGNITION
  const pattern_score = analyzePatterns(seq);

  // 4. PHÂN TÍCH TỔNG ĐIỂM
  const tong_score = analyzeTong(recentTong);

  // 5. PHÂN TÍCH CHU KỲ
  const cycle_score = analyzeCycles(seq);

  // 6. BẢNG TRA MD5 (Thêm từ file mẹo)
  const lastTong = tongSeq[0];
  const md5 = MD5_TIPS[lastTong] || { result: "Chưa rõ", confidence: 50 };
  const md5_score = {
    Tài: md5.result === "Tài" ? md5.confidence / 100 : (100 - md5.confidence) / 100,
    Xỉu: md5.result === "Xỉu" ? md5.confidence / 100 : (100 - md5.confidence) / 100,
  };

  // 7. BẢNG TRA XÚC XẮC (Thêm từ file mẹo)
  const lastDice = history[0];
  let dice_score = { Tài: 0.5, Xỉu: 0.5 };
  let diceConfidence = 0;
  if (lastDice && lastDice.x1 !== undefined) {
    const sorted = [lastDice.x1, lastDice.x2, lastDice.x3].sort((a, b) => a - b).join("");
    const dt = DICE_TABLE[lastDice.tong] ? DICE_TABLE[lastDice.tong][sorted] : null;
    if (dt && dt.result !== "BỎ") {
      dice_score = {
        Tài: dt.result === "Tài" ? dt.confidence / 100 : (100 - dt.confidence) / 100,
        Xỉu: dt.result === "Xỉu" ? dt.confidence / 100 : (100 - dt.confidence) / 100,
      };
      diceConfidence = dt.confidence;
    }
  }

  // TỔNG HỢP TRỌNG SỐ
  const weights = {
    frequency: 0.12, markov: 0.15, pattern: 0.15, tong: 0.10, cycle: 0.10,
    md5: 0.13, dice: 0.15, cau: 0.10 // Thêm trọng số cho cầu
  };

  // 8. PHÂN TÍCH CẦU (Từ quy tắc đọc cầu)
  let cau_score = { Tài: 0.5, Xỉu: 0.5 };
  if (seq.length >= 6) {
    let alternate = 0;
    for (let i = 0; i < Math.min(seq.length - 1, 10); i++) if (seq[i] !== seq[i+1]) alternate++;
    if (alternate >= 6) { cau_score = { Tài: 0.5, Xỉu: 0.5 }; } // Cầu 1-1
    
    let bet = 1;
    for (let i = 1; i < Math.min(seq.length, 10); i++) { if (seq[i] === seq[0]) bet++; else break; }
    if (bet >= 5) { cau_score = seq[0] === "Tài" ? { Tài: 0.3, Xỉu: 0.7 } : { Tài: 0.7, Xỉu: 0.3 }; }
  }

  const final_score = {
    Tài: (
      frequency_score.Tài * weights.frequency +
      markov_score.Tài * weights.markov +
      pattern_score.Tài * weights.pattern +
      tong_score.Tài * weights.tong +
      cycle_score.Tài * weights.cycle +
      md5_score.Tài * weights.md5 +
      dice_score.Tài * weights.dice +
      cau_score.Tài * weights.cau
    ),
    Xỉu: (
      frequency_score.Xỉu * weights.frequency +
      markov_score.Xỉu * weights.markov +
      pattern_score.Xỉu * weights.pattern +
      tong_score.Xỉu * weights.tong +
      cycle_score.Xỉu * weights.cycle +
      md5_score.Xỉu * weights.md5 +
      dice_score.Xỉu * weights.dice +
      cau_score.Xỉu * weights.cau
    )
  };

  // QUYẾT ĐỊNH CUỐI CÙNG
  const threshold = 0.08;
  const diff = Math.abs(final_score.Tài - final_score.Xỉu);

  let result, confidence;

  if (diff < threshold) {
    const last3 = recent.slice(0, 3);
    const last3Tai = last3.filter(s => s === "Tài").length;
    const last3Xiu = last3.filter(s => s === "Xỉu").length;
    
    if (last3Tai > last3Xiu) result = "Tài";
    else if (last3Xiu > last3Tai) result = "Xỉu";
    else result = tai_count >= xiu_count ? "Tài" : "Xỉu";
    confidence = 50;
  } else {
    result = final_score.Tài > final_score.Xỉu ? "Tài" : "Xỉu";
    confidence = Math.round(Math.max(final_score.Tài, final_score.Xỉu) * 100);
  }

  // GHI ĐÈ NẾU CÓ MẸO XÚC XẮC/ MD5 TỶ LỆ CAO
  if (md5.confidence >= 75 && md5.result !== "BỎ") { result = md5.result; confidence = md5.confidence; }
  if (diceConfidence >= 80 && dice_score.Tài !== 0.5) { result = dice_score.Tài > dice_score.Xỉu ? "Tài" : "Xỉu"; confidence = diceConfidence; }

  // KHUNG GIỜ KHÔNG CHẠY (12h đêm - 5h sáng)
  const h = new Date().getHours();
  if (h >= 0 && h < 5) confidence = Math.min(confidence, 40);

  return result; // Trả về chuỗi "Tài" hoặc "Xỉu"
}

// Hàm dự đoán chính (tương thích)
function duDoan(history, last_n = 12) {
  return duDoanNangCao(history, last_n);
}

// Cập nhật lịch sử
function updateResult(store, history, result) {
  Object.assign(store, result);
  history.unshift({ ...result });
  if (history.length > MAX_HISTORY) history.pop();
}

/* ============================================================
    PHẦN API RENDER TRẢ VỀ JSON CHUẨN ẢNH 2
   ============================================================ */
app.get('/api/predict', async (req, res) => {
  try {
    const response = await axios.get(API_URL);
    const data = response.data;
    if (!data.list || data.list.length === 0) return res.status(404).json({ error: "Không có dữ liệu" });

    const currentSession = data.list[0];
    const nextSessionId = currentSession.id + 1;
    
    // 1. Lấy kết quả dự đoán từ hàm gốc
    const predictionResult = duDoanNangCao(data.list);
    
    // 2. Tính toán độ tin cậy
    let confidence = calculateConfidence(data.list, predictionResult);
    // Nếu độ tin cậy tính toán thấp, fallback về mức mặc định
    if (confidence === 0) confidence = 65; 

    const historyList = [];
    let thang = 0, thua = 0;
    let chuoiThangHienTai = 0, chuoiThuaHienTai = 0;
    let chuoiThangDaiNhat = 0, chuoiThuaDaiNhat = 0;

    // 3. Chạy thuật toán ngược lại 15 phiên để tạo lịch sử thắng/thua
    for (let i = 0; i < 15; i++) {
      const session = data.list[i];
      const isLatest = i === 0;
      
      // Gọi hàm gốc cho từng phiên trong quá khứ
      const duDoan = isLatest ? predictionResult : duDoanNangCao(data.list.slice(i));
      const ketQua = isLatest ? "dang_cho" : (session.resultTruyenThong === "TAI" ? "Tài" : "Xỉu");
      
      let trangThai = "dang_cho";
      if (!isLatest) {
        const isWin = duDoan === ketQua;
        trangThai = isWin ? "thang" : "thua";
        
        if (isWin) {
          thang++;
          chuoiThangHienTai++;
          chuoiThuaHienTai = 0;
          if (chuoiThangHienTai > chuoiThangDaiNhat) chuoiThangDaiNhat = chuoiThangHienTai;
        } else {
          thua++;
          chuoiThuaHienTai++;
          chuoiThangHienTai = 0;
          if (chuoiThuaHienTai > chuoiThuaDaiNhat) chuoiThuaDaiNhat = chuoiThuaHienTai;
        }
      }

      historyList.push({
        phien: session.id,
        du_doan: duDoan,
        ket_qua: ketQua,
        trang_thai: trangThai
      });
    }

    const lichSu = historyList.reverse();
    const tongPhien = thang + thua;
    const tiLeThang = tongPhien > 0 ? ((thang / tongPhien) * 100).toFixed(1) + "%" : "0%";
    const now = new Date();
    const timeString = now.toLocaleTimeString('vi-VN', { hour12: false }) + " " + now.toLocaleDateString('vi-VN');

    // 4. Trả ra JSON đúng chuẩn ảnh 2
    const output = {
      id: "@tiendataox",
      game: "LC79 MD5",
      phien_truoc: currentSession.id,
      xuc_xac1: currentSession.dices[0],
      xuc_xac2: currentSession.dices[1],
      xuc_xac3: currentSession.dices[2],
      ket_qua: currentSession.resultTruyenThong === "TAI" ? "Tài" : "Xỉu",
      thoi_gian: timeString,
      phien_nay: nextSessionId,
      du_doan: predictionResult,
      do_tin_cay: confidence + "%",
      thong_ke: {
        thang: thang,
        thua: thua,
        tong: tongPhien,
        ti_le_thang: tiLeThang,
        chuoi_thang_hien_tai: chuoiThangHienTai,
        chuoi_thua_hien_tai: chuoiThuaHienTai,
        chuoi_thang_dai_nhat: chuoiThangDaiNhat,
        chuoi_thua_dai_nhat: chuoiThuaDaiNhat
      },
      lich_su: lichSu
    };

    res.json(output);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Bắt buộc phải có hàm listen để Render không báo lỗi exit code 1
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server chạy trên port ${PORT}`);
});
