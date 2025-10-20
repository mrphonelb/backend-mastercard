require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const app = express();

app.use(cors({
  origin: [
    "https://www.mrphonelb.com",
    "https://mrphone-backend.onrender.com",
    "http://localhost:3000"
  ],
  methods: ["GET","POST","OPTIONS"],
  allowedHeaders: ["Content-Type"]
}));
app.use(express.json());

const port = process.env.PORT || 3000;

app.get("/", (_,res)=>res.send("✅ MrPhone Backend Live"));

/* ================================
   CREATE SESSION
================================ */
app.post("/initiate-checkout", async (req,res)=>{
  const { draftId, amount, currency="USD" } = req.body;
  if(!draftId) return res.status(400).json({error:"Missing draftId"});
  if(!amount) return res.status(400).json({error:"Missing amount"});

  try{
    console.log(`🧾 Creating Mastercard session for ${draftId} (${amount} ${currency})`);
    const payload = {
      apiOperation: "INITIATE_CHECKOUT",
      interaction: {
        operation: "PURCHASE",
        returnUrl: `${process.env.PUBLIC_BASE_URL}/payment-result/${draftId}`
      },
      order: {
        id: draftId,
        amount: Number(amount),
        currency
      }
    };

    const response = await axios.post(
      `${process.env.HOST}api/rest/version/100/merchant/${process.env.MERCHANT_ID}/session`,
      payload,
      {
        auth: {
          username: `merchant.${process.env.MERCHANT_ID}`,
          password: process.env.API_PASSWORD
        },
        headers: {"Content-Type":"application/json"}
      }
    );

    const sessionId = response.data.session.id;
    console.log("✅ Session:", sessionId);
    res.json({sessionId});
  }catch(err){
    console.error("❌ INITIATE_CHECKOUT failed:", err.response?.data || err.message);
    res.status(500).json({error:"Failed to create session"});
  }
});

/* ================================
   VERIFY PAYMENT
================================ */
app.get("/payment-result/:draftId", async (req,res)=>{
  const {draftId}=req.params;
  try{
    const verify = await axios.get(
      `${process.env.HOST}api/rest/version/100/merchant/${process.env.MERCHANT_ID}/order/${draftId}`,
      {
        auth:{
          username:`merchant.${process.env.MERCHANT_ID}`,
          password:process.env.API_PASSWORD
        }
      }
    );
    const result=(verify.data.result||"UNKNOWN").toUpperCase();
    console.log(`💬 Payment ${draftId}: ${result}`);

    res.send(`
      <script>
        window.opener?.postMessage("${result}-${draftId}","*");
        window.close();
      </script>
    `);
  }catch(e){
    console.error("❌ Verify failed:", e.message);
    res.send(`
      <script>
        window.opener?.postMessage("FAILURE-${draftId}","*");
        window.close();
      </script>
    `);
  }
});

app.listen(port,"0.0.0.0",()=>console.log(`✅ Backend running on port ${port}`));
