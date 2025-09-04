import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import OpenAI from "openai";
import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

// ✅ ERP constants
const ERP_API = "http://sandboxgsuite.graphicstar.com.ph/api/get_sales_orders";
const TOKEN = process.env.ERP_TOKEN;
const LOCATION_PK = "00a18fc0-051d-11ea-8e35-aba492d8cb65";
const EMPL_PK = "ef0926b0-04ff-11ee-8114-5534a282e29b";

// ✅ OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 🔹 Helper: Determine intent and payload
async function questionToQuery(question) {
  const systemPrompt = `
You are an ERP query builder.
Return JSON with "intent" (count, total, breakdown, max, min, list) and ERP payload.
Default date range: 2000-01-01 to 2099-12-31.
`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: question }
    ],
    temperature: 0
  });

  return JSON.parse(completion.choices[0].message.content);
}

// 🔹 Call ERP
async function callERP(payload) {
  const response = await fetch(ERP_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  return response.json();
}

// 🔹 Summarize
async function summarizeAnswer(question, intent, erpData) {
  const soArray = (erpData.data && erpData.data[0]) || [];
  const totalSO = (erpData.data && erpData.data[1]) || soArray.length;

  const flattenedERPData = {
    soList: soArray.map(so => so.so_upk),
    total: totalSO,
    fullData: soArray
  };

  // Check if question asks for a specific SO
  const soNumberMatch = question.match(/SO-\d+/i);
  if (soNumberMatch) {
    const requestedSO = soNumberMatch[0];
    const soObj = soArray.find(so => so.so_upk === requestedSO);
    if (soObj) {
      return `Sales Order ${requestedSO} details:\n- Status: ${soObj.Status_TransH}\n- Total Amount: ${soObj.TotalAmount_TransH}\n- Customer: ${soObj.Name_Cust}\n- Date Created: ${soObj.DateCreated_TransH}`;
    } else {
      return `Sales order ${requestedSO} was not found.`;
    }
  }

  // General AI summary
  const systemPrompt = `
You are a helpful assistant answering ERP sales order questions.
ERP data: soList, total, fullData
Intent: count, total, list, max, min, breakdown
`;
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Question: ${question}\nIntent: ${intent}\nERP Data: ${JSON.stringify(flattenedERPData)}` }
    ]
  });

  return completion.choices[0].message.content;
}

// 🔹 Chatbot endpoint
app.post("/chatbot", async (req, res) => {
  try {
    const { question } = req.body;

    const { intent, payload } = await questionToQuery(question);
    const erpData = await callERP(payload);
    const answer = await summarizeAnswer(question, intent, erpData);

    res.json({ question, intent, payload, answer });
  } catch (err) {
    console.error("❌ Chatbot error:", err);
    res.status(500).json({ error: "Chatbot failed" });
  }
});

// 🔹 Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Chatbot running on port ${PORT}`));
