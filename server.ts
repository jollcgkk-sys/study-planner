import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  app.use(express.json());

  // API Route for Ask-Gemini proxying
  app.post("/api/ask-gemini", async (req, res) => {
    try {
      const { prompt, model, customApiKey } = req.body;

      // Determine which API key to use
      const apiKey = customApiKey?.trim() || process.env.GEMINI_API_KEY;

      if (!apiKey) {
        return res.status(400).json({
          error: {
            message: "مفتاح Gemini API غير مهيأ. يرجى إدخال مفتاح API في واجهة المساعد أو تهيئته في لوحة التحكم الخاصة بالتطبيق.",
            code: "MISSING_API_KEY"
          }
        });
      }

      const activeModel = model || "gemini-3.5-flash";

      // Determine model queue for robust fallback in case of high demand / 503
      const modelQueue = [activeModel];
      if (activeModel !== "gemini-3.5-flash") {
        modelQueue.push("gemini-3.5-flash");
      }
      if (activeModel !== "gemini-3.1-flash-lite") {
        modelQueue.push("gemini-3.1-flash-lite");
      }

      // Initialize the Gemini client server-side
      const ai = new GoogleGenAI({
        apiKey: apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });

      let response;
      let lastError: any = null;

      for (const currentModel of modelQueue) {
        try {
          response = await ai.models.generateContent({
            model: currentModel,
            contents: prompt,
            config: {
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  isGeneralQuestion: { 
                    type: Type.BOOLEAN, 
                    description: "True if the question is general study help, chat, greetings, or study advice. False if searching or retrieving their schedule, tasks, or subjects." 
                  },
                  answer: { 
                    type: Type.STRING, 
                    description: "Direct helpful response in Arabic (friendly study assistant tone). Must answer any general questions fully in Arabic, or write a short brief intro for specific schedule data." 
                  },
                  targetTypes: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                    description: "Desired task types: 'prep', 'homework', 'project', 'subject_note'."
                  },
                  isAllTasks: { type: Type.BOOLEAN },
                  isImportantOnly: { type: Type.BOOLEAN },
                  isProjectsOnly: { type: Type.BOOLEAN },
                  targetDay: { type: Type.INTEGER, description: "Day index 0 to 6 (0=Monday, 6=Sunday), or null." },
                  targetSubjectId: { type: Type.STRING, description: "The UUID of the subject if named, or null." }
                },
                required: ["isGeneralQuestion", "answer"]
              }
            }
          });
          // If successful, break the loop
          break;
        } catch (err: any) {
          console.warn(`[Gemini Proxy Warning] Failed with model ${currentModel}, trying fallback if available. Error:`, err);
          lastError = err;

          const errMsg = err?.message || String(err);
          // If the error is critical credential-wise (403 or 400), don't bother retrying with other models as they will fail too
          if (
            errMsg.includes("403") || 
            errMsg.includes("permission") || 
            errMsg.includes("PERMISSION_DENIED") ||
            errMsg.includes("400") || 
            errMsg.includes("API key not valid")
          ) {
            break;
          }
        }
      }

      if (!response) {
        throw lastError || new Error("فشلت جميع محاولات الاتصال بخدمة الذكاء الاصطناعي.");
      }

      const text = response.text;
      if (!text) {
        throw new Error("لم تستجب خدمة الذكاء الاصطناعي بأي محتوى.");
      }

      const resultData = JSON.parse(text);
      return res.json(resultData);

    } catch (err: any) {
      console.error("[Backend Gemini Error]:", err);
      
      let errorMsg = err?.message || String(err);
      let errStatus = 500;
      let errCode = "INTERNAL_ERROR";

      // Detect common Gemini error patterns to provide beautiful Arabic explanation
      if (errorMsg.includes("403") || errorMsg.includes("permission") || errorMsg.includes("PERMISSION_DENIED")) {
        errorMsg = "انتهت الصلاحية أو أن المفتاح المدخل غير مصرح له باستخدام النموذج المختار. يرجى التحقق من صحة مفتاح الـ API وتفعيله في صفحة المساعد.";
        errStatus = 403;
        errCode = "PERMISSION_DENIED";
      } else if (errorMsg.includes("400") || errorMsg.includes("API key not valid")) {
        errorMsg = "مفتاح API المدخل غير صالح. يرجى التأكد من نسخه بشكل صحيح من Google AI Studio.";
        errStatus = 400;
        errCode = "INVALID_API_KEY";
      } else if (errorMsg.includes("quota") || errorMsg.includes("429")) {
        errorMsg = "تم تجاوز حد الاستهلاك المسموح به لمفتاح API هذا. يرجى الانتظار قليلاً أو تبديل المفتاح.";
        errStatus = 429;
        errCode = "QUOTA_EXCEEDED";
      } else if (errorMsg.includes("503") || errorMsg.includes("UNAVAILABLE") || errorMsg.includes("demand") || errorMsg.includes("temporary")) {
        errorMsg = "تواجه خوادم المساعد الذكي ضغطاً مؤقتاً كبيراً في هذه اللحظة. يرجى إعادة المحاولة مجدداً خلال ثوانٍ معدودة.";
        errStatus = 503;
        errCode = "SERVICE_UNAVAILABLE";
      }

      return res.status(errStatus).json({
        error: {
          message: errorMsg,
          code: errCode,
          originalError: err?.message || String(err)
        }
      });
    }
  });

  // Serve static files in production, use Vite in dev
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    console.log("[Server] Running in development mode with Vite Middleware.");
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
    console.log("[Server] Running in production mode serving static dist.");
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Server] Web server booted on http://localhost:${PORT}`);
  });
}

startServer();
