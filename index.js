const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');

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

    const translatedQuery = await translateToEnglish(originalQuery);

    const appKey = process.env.ALI_APP_KEY;
    const appSecret = process.env.ALI_APP_SECRET;
    const trackingId = process.env.ALI_TRACKING_ID;

    if (!appKey || !appSecret || !trackingId) {
      return res.status(500).json({ error: "חסרים משתני סביבה בשרת" });
    }

    // הבקשה לעליאקספרס: תביאו 50 מוצרים, אנחנו נסנן את המחיר לבד!
    const params = {
      app_key: appKey,
      method: "aliexpress.affiliate.product.query",
      timestamp: Date.now(),
      format: "json",
      v: "2.0",
      sign_method: "md5",
      keywords: translatedQuery,
      page_no: page,
      page_size: "50", // משיכת כמות גדולה של מוצרים כדי שיהיה מה לסנן
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

    // --- מערכת הסלקטור העצמאית שלנו ---
    if (minPrice || maxPrice) {
      products = products.filter(p => {
        // מזהים את המחיר המדויק (לפעמים מגיע כטווח, אז ניקח את המספר הראשון)
        const priceStr = (p.target_app_sale_price || p.target_sale_price || "0").toString().split("-")[0];
        const itemPrice = parseFloat(priceStr);
        
        const min = minPrice ? parseFloat(minPrice) : 0;
        const max = maxPrice ? parseFloat(maxPrice) : Infinity;
        
        return itemPrice >= min && itemPrice <= max;
      });
    }

    // אחרי שניקינו את כל הזבל, נחתוך ל-10 המוצרים הטובים ביותר ונחזיר
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
