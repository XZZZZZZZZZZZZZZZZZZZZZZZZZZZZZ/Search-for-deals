const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');

// מושך את הרשימה השחורה מהקובץ החיצוני
const blackList = require('./blacklist.json');

const app = express();
app.use(cors());

app.use(express.static(path.join(__dirname, 'public')));

const port = process.env.PORT || 8000;

async function translateToEnglish(text) {
  try {
    if (!/[\u0590-\u05FF]/.test(text)) return text;
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=iw&tl=en&dt=t&q=${encodeURIComponent(text)}`;
    const response = await fetch(url);
    const data = await response.json();
    return data[0][0][0];
  } catch (error) {
    console.error("שגיאת תרגום:", error);
    return text;
  }
}

function getExactPrice(p) {
  const rawPrice = p.target_app_sale_price_attain_value || 
                   p.target_sale_price_attain_value || 
                   p.target_app_sale_price || 
                   p.target_sale_price || 
                   "0";
  const priceStr = rawPrice.toString().split("-")[0].replace(/[^\d.]/g, "");
  return parseFloat(priceStr) || 0;
}

app.get('/api/search', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  
  try {
    const originalQuery = req.query.q;
    const page = req.query.page || "1";
    const minPrice = req.query.min || ""; 
    const maxPrice = req.query.max || "";

    if (!originalQuery) {
      return res.status(400).json({ error: "אנא הזן מילת חיפוש" });
    }

    const queryLower = originalQuery.toLowerCase();
    const isQueryBlocked = blackList.some(word => queryLower.includes(word.toLowerCase()));
    
    if (isQueryBlocked) {
      return res.status(400).json({ error: "החיפוש שלכם לא תואם את הגדרות הסינון" });
    }

    const translatedQuery = await translateToEnglish(originalQuery);

    const translatedLower = translatedQuery.toLowerCase();
    const isTranslatedBlocked = blackList.some(word => translatedLower.includes(word.toLowerCase()));

    if (isTranslatedBlocked) {
      return res.status(400).json({ error: "החיפוש שלכם לא תואם את הגדרות הסינון" });
    }

    const appKey = process.env.ALI_APP_KEY;
    const appSecret = process.env.ALI_APP_SECRET;
    const trackingId = process.env.ALI_TRACKING_ID;

    if (!appKey || !appSecret || !trackingId) {
      return res.status(500).json({ error: "חסרים משתני סביבה בשרת" });
    }

    const params = {
      app_key: appKey,
      method: "aliexpress.affiliate.product.query",
      timestamp: Date.now(),
      format: "json",
      v: "2.0",
      sign_method: "md5",
      keywords: translatedQuery,
      page_no: page,
      page_size: "50", 
      tracking_id: trackingId,
      ship_to_country: "IL",
      target_currency: "ILS",
      target_language: "HE"
    };

    params.sign = generateSign(params, appSecret);

    const url = new URL("https://api-sg.aliexpress.com/sync");
    Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));

    const response = await fetch(url.toString(), { method: 'GET' });
    const data = await response.json();
    
    let products = data?.aliexpress_affiliate_product_query_response?.resp_result?.result?.products?.product || [];
    
    if (products.length === 0 && data?.error_response) {
        return res.status(400).json({ error: data.error_response.msg, code: data.error_response.code });
    }

    products = products.filter(p => {
      const itemPrice = getExactPrice(p);
      const min = minPrice ? parseFloat(minPrice) : 0;
      const max = maxPrice ? parseFloat(maxPrice) : Infinity;
      const isValidPrice = itemPrice >= min && itemPrice <= max;

      const rating = parseFloat(p.evaluate_rate || "0");
      const isValidRating = rating >= 4.0 || rating === 0;

      const titleLower = (p.product_title || "").toLowerCase();
      const hasBlacklistWord = blackList.some(word => titleLower.includes(word.toLowerCase()));

      return isValidPrice && isValidRating && !hasBlacklistWord;
    });

    products = products.map(p => {
      const exactPrice = getExactPrice(p);
      return {
        ...p,
        target_app_sale_price: exactPrice.toString()
      };
    });

    products = products.slice(0, 10);
    res.json(products);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

function generateSign(params, secret) {
  const sorted = Object.keys(params).sort();
  let base = secret;
  sorted.forEach(key => { base += key + params[key]; });
  base += secret;
  return crypto.createHash("md5").update(base).digest("hex").toUpperCase();
}

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
