import { describe, expect, it } from "vitest";
import { toKinesisRecords } from "./kinesis.js";
import { deidentify } from "../gemini/summary.js";

describe("kinesis records", () => {
  it("partitions each batch by patient id", () => {
    const records = toKinesisRecords([
      {
        deviceId: "device-01",
        patientId: "p_abc",
        seq: 3,
        receivedAt: 10,
        readings: [
          {
            ts: 10,
            bpm: 70,
            ibiMs: [],
            signalQuality: 1,
            activity: "rest",
            motionMag: 0,
            fallDetected: false,
            skinTempC: 33,
            spo2: 98,
            spo2Simulated: true,
          },
        ],
      },
    ]);
    expect(records[0].PartitionKey).toBe("p_abc");
    expect(JSON.parse(new TextDecoder().decode(records[0].Data)).seq).toBe(3);
  });
});

describe("de-identification", () => {
  it("drops the patient name before anything is sent to Gemini", () => {
    const summary = deidentify({
      id: "p_1",
      displayName: "Jane Doe",
      ctas: 3,
      enrollmentReason: "chest_pain",
      baselineBpm: 72,
      skinBaselineC: 33.4,
      officialTempC: 36.8,
      rollup: null,
      flags: [],
    });
    expect(JSON.stringify(summary)).not.toContain("Jane");
    expect(summary.ref).toBe("p_1");
  });
});
