import { describe, it, expect } from "vitest";
import {
  trainGBDT,
  predictGBDT,
  predictBatchGBDT,
  extractFeatures,
  FLAKER_FEATURE_NAMES,
  type TrainingRow,
} from "../../src/cli/eval/gbdt.js";

describe("GBDT", () => {
  it("trains and predicts on linearly separable data", () => {
    // Simple: feature[0] > 5 → label=1, else label=0
    const data: TrainingRow[] = [];
    for (let i = 0; i < 20; i++) {
      data.push({
        features: [i],
        label: i > 10 ? 1 : 0,
      });
    }

    const model = trainGBDT(data, {
      numTrees: 10,
      learningRate: 0.3,
      featureNames: ["value"],
    });

    expect(model.trees.length).toBe(10);

    // Low values should predict close to 0
    expect(predictGBDT(model, [0])).toBeLessThan(0.3);
    expect(predictGBDT(model, [5])).toBeLessThan(0.3);

    // High values should predict close to 1
    expect(predictGBDT(model, [15])).toBeGreaterThan(0.7);
    expect(predictGBDT(model, [19])).toBeGreaterThan(0.7);
  });

  it("handles multi-feature data", () => {
    // label=1 when feature[0] > 5 AND feature[1] > 3
    const data: TrainingRow[] = [];
    for (let i = 0; i < 10; i++) {
      for (let j = 0; j < 10; j++) {
        data.push({
          features: [i, j],
          label: i > 5 && j > 3 ? 1 : 0,
        });
      }
    }

    const model = trainGBDT(data, {
      numTrees: 20,
      learningRate: 0.3,
      featureNames: ["f0", "f1"],
    });

    // Both features high → predict 1
    expect(predictGBDT(model, [8, 7])).toBeGreaterThan(0.5);
    // Feature 0 low → predict 0
    expect(predictGBDT(model, [2, 7])).toBeLessThan(0.5);
  });

  it("predictBatchGBDT returns array of predictions", () => {
    const data: TrainingRow[] = Array.from({ length: 20 }, (_, i) => ({
      features: [i],
      label: i > 10 ? 1 : 0,
    }));

    const model = trainGBDT(data, { numTrees: 5, learningRate: 0.3 });
    const preds = predictBatchGBDT(model, [[0], [5], [15], [19]]);

    expect(preds).toHaveLength(4);
    expect(preds[0]).toBeLessThan(preds[3]);
  });

  it("handles empty training data", () => {
    const model = trainGBDT([], { numTrees: 5 });
    expect(model.trees).toHaveLength(0);
  });

  it("model is serializable to JSON", () => {
    const data: TrainingRow[] = Array.from({ length: 20 }, (_, i) => ({
      features: [i],
      label: i > 10 ? 1 : 0,
    }));

    const model = trainGBDT(data, { numTrees: 5, featureNames: ["x"] });
    const json = JSON.stringify(model);
    const restored = JSON.parse(json);

    expect(predictGBDT(restored, [0])).toBe(predictGBDT(model, [0]));
    expect(predictGBDT(restored, [15])).toBe(predictGBDT(model, [15]));
  });

  it("extractFeatures maps TestMeta fields correctly", () => {
    const features = extractFeatures({
      flaky_rate: 25.0,
      co_failure_boost: 100,
      total_runs: 10,
      fail_count: 3,
      avg_duration_ms: 500,
      previously_failed: true,
      is_new: false,
    });

    expect(features).toEqual([25.0, 100, 10, 3, 500, 1, 0]);
    expect(features.length).toBe(FLAKER_FEATURE_NAMES.length);
  });
});
