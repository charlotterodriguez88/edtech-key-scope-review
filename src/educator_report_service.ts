import express from "express";
import { InfraiError, createAccessReview, reviewRequestSchema } from "./access_review.js";

const app = express();
app.use(express.json({ limit: "100kb" }));

app.post("/access-reviews", async (request, response) => {
  const input = reviewRequestSchema.safeParse(request.body);
  if (!input.success) {
    response.status(400).json({ error: "Invalid review request", details: input.error.flatten() });
    return;
  }
  const key = process.env.INFRAI_API_KEY;
  if (!key) {
    response.status(503).json({ error: "INFRAI_API_KEY is required" });
    return;
  }
  try {
    response.status(201).json(await createAccessReview(input.data, key));
  } catch (error) {
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      response.status(status).json({ error: error.code, message: error.message });
      return;
    }
    response.status(500).json({ error: "REPORT_CREATION_FAILED" });
  }
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`Educator access review service listening on http://localhost:${port}`));
