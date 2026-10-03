import { describe, expect, it } from "vitest";
import { evaluateAccessReview, reviewRequestSchema } from "../src/access_review.js";

describe("educator access decision", () => {
  it("marks an overdue learner blocked when no key reaches course delivery", () => {
    const input = reviewRequestSchema.parse({
      course: { id: "biology-101", title: "Biology 101", deliveryScope: "course.delivery" },
      learners: [{ id: "learner-7", name: "Mina", dueAt: "2026-09-20T17:00:00Z" }],
      asOf: "2026-10-01T09:00:00Z",
      reportDate: "2026-10-01"
    });

    const result = evaluateAccessReview(input, [
      { id: "key-reporting", name: "reporting", scopes: ["pdf.generate"] }
    ]);

    expect(result.learners).toEqual([{
      learnerId: "learner-7",
      learnerName: "Mina",
      deadline: "overdue",
      delivery: "blocked"
    }]);
    expect(result.keyAccess[0]).toMatchObject({ canDeliverCourse: false, canRenderReport: true });
  });
});
