import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import OpenAI from "openai";
import "dotenv/config";

const app = express();
app.use(express.json());
app.use(cors());

// ✅ ERP constants
const ERP_API = "http://sandboxgsuite.graphicstar.com.ph/api/get_sales_orders";
const TOKEN = process.env.ERP_TOKEN; // move token to .env
const LOCATION_PK = "00a18fc0-051d-11ea-8e35-aba492d8cb65";
const EMPL_PK = "ef0926b0-04ff-11ee-8114-5534a282e29b";

// ✅ OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// 🔹 Step 1: GPT → ERP payload + intent
async function questionToQuery(question) {
  const systemPrompt = `
You are an ERP query builder. 
Given a user question about sales orders, return a JSON object:

{
  "intent": "count" | "total" | "breakdown" | "max" | "min" | "list",
  "payload": {
    "empl_pk": "${EMPL_PK}",
    "preparedBy": "System Administrator",
    "viewAll": 1,
    "searchKey": "",
    "customerPK": null,
    "departmentPK": null,
    "filterDate": {
      "filter": "between",
      "date1": { "hide": false, "date": "YYYY-MM-DD" },
      "date2": { "hide": false, "date": "YYYY-MM-DD" }
    },
    "limit": 500,
    "offset": 0,
    "locationPK": "${LOCATION_PK}",
    "salesRepPK": null
  }
}

Rules:
- Detect if user wants count, total, breakdown, max, min, or list.
- Parse any date range. Default: Jan 01, 2000 → Dec 31, 2099.
- Return JSON only.
`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: question },
    ],
    temperature: 0,
  });

  return JSON.parse(completion.choices[0].message.content);
}

// 🔹 Step 2: Call ERP API
async function callERP(payload) {
  const response = await fetch(ERP_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  return response.json();
}

// 🔹 Step 3: Summarize & Answer
async function summarizeAnswer(question, intent, erpData) {
  const soArray = (erpData.data && erpData.data[0]) || [];
  const totalSO = (erpData.data && erpData.data[1]) || soArray.length;

  const flattenedERPData = {
    soList: soArray.map(so => so.so_upk),
    total: totalSO,
    fullData: soArray
  };

  // --- Check for specific SO query ---
  const soNumberMatch = question.match(/SO-\d+/i);
  if (soNumberMatch) {
    const requestedSO = soNumberMatch[0];
    const soObj = soArray.find(so => so.so_upk === requestedSO);
    if (soObj) {
      return `Sales Order ${requestedSO} details:
- Status: ${soObj.Status_TransH}
- Total Amount: ${soObj.TotalAmount_TransH}
- Customer: ${soObj.Name_Cust}
- Date Created: ${soObj.DateCreated_TransH}`;
    } else {
      return `Sales order ${requestedSO} was not found in the selected range.`;
    }
  }

  // --- General / hybrid AI (multilingual) ---
  const systemPrompt = `
You are a helpful assistant answering ERP sales order questions and general queries. 
You understand English, Tagalog, Bisaya, and mixed sentences.
ERP data contains: soList, total, fullData.
Intent may be: count, list, total, max, min, breakdown.

Rules:
- "count": return total SOs
- "list": list all SO numbers
- "total": sum TotalAmount_TransH
- "max": SO with highest TotalAmount_TransH
- "min": SO with lowest TotalAmount_TransH
- "breakdown": group by customer, department, or month
- Answer naturally in the same language or mix the user used.
- If soList is empty, say "No sales orders found."
- If question is general (math, conversions, etc.), answer naturally.
`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Question: ${question}\nIntent: ${intent}\nERP Data: ${JSON.stringify(flattenedERPData)}` },
    ],
  });

  return completion.choices[0].message.content;
}

// 🔹 Chatbot endpoint
app.post("/chatbot", async (req, res) => {
  try {
    const { question } = req.body;
    console.log("💬 User asked:", question);

    // Step 1: Parse question
    const { intent, payload } = await questionToQuery(question);
    console.log("➡️ Intent:", intent);

    // Step 2: Fetch ERP
    const erpData = await callERP(payload);

    // Step 3: Summarize / hybrid answer
    const answer = await summarizeAnswer(question, intent, erpData);

    res.json({ question, intent, answer });
  } catch (err) {
    console.error("❌ Chatbot error:", err);
    res.status(500).json({ error: "Chatbot failed" });
  }
});

app.listen(3000, () => {
  console.log("✅ Chatbot running on http://localhost:3000");
});
