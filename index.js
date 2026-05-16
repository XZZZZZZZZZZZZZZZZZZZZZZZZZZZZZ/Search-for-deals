const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');

const app = express();
app.use(cors());

app.use(express.static(path.join(__dirname, 'public')));

const port = process.env.PORT || 8000;

app.get('/api/search', async (req, res) => {
  // הפקודה הזו מונעת מהשרת "להיתקע" על אותן תוצאות (מונעת Cache)
  res.setHeader('Cache-Control', 'no-store');
  
  try {
    const query = req.query.q;
    const page = req.query.page || "1";

    if (!query) {
      return res.status(400).json({ error: "אנא הזן מילת חיפוש" });
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
      keywords: query,
      page_no: page,
      tracking_id: trackingId,
      ship_to_country: "IL",
      target_currency: "ILS",
      target_language: "HE"
      // הערה: מחקנו מכאן את פקודת המיון כדי שהמערכת תתמקד אך ורק במילת החיפוש!
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

    // חותך ל-10 מוצרים ומחזיר
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
