#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_BMP085.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_ADXL345_U.h>

// Uno Q App Lab sketch. The MCU samples the HW-827 pulse sensor and the GY-80,
// then emits one JSON reading per second. python/main.py batches five of those
// and posts them with the device token. Confirm both boards are powered at 3.3V.

static const int PULSE_PIN = A0;
static const uint32_t SAMPLE_US = 2000; // 500 Hz
static const float FALL_DIP_G = 0.4f;
static const float FALL_SPIKE_G = 2.5f;

Adafruit_BMP085 bmp;
Adafruit_ADXL345_Unified accel = Adafruit_ADXL345_Unified(12345);

float baseline = 520;
float lastPeakAt = 0;
float bpm = 0;
bool beatHigh = false;
float amplitude = 0;
uint32_t windowStart = 0;
int beats = 0;
float motionSum = 0;
int motionN = 0;
bool sawDip = false;
bool fallLatched = false;
uint32_t lastEmit = 0;

float magnitudeG(float x, float y, float z) {
  return sqrtf(x * x + y * y + z * z) / 9.80665f;
}

void setup() {
  Serial.begin(115200);
  Wire.begin();
  bmp.begin();
  accel.begin();
  accel.setRange(ADXL345_RANGE_8_G);
  windowStart = millis();
  lastEmit = millis();
}

void loop() {
  static uint32_t lastSample = 0;
  uint32_t nowUs = micros();
  if (nowUs - lastSample < SAMPLE_US) return;
  lastSample = nowUs;

  int sample = analogRead(PULSE_PIN);
  baseline += (sample - baseline) * 0.01f;
  float delta = sample - baseline;
  amplitude = amplitude * 0.99f + fabsf(delta) * 0.01f;
  float threshold = max(amplitude * 0.5f, 8.0f);
  float nowMs = millis();
  if (!beatHigh && delta > threshold && nowMs - lastPeakAt > 300) {
    if (lastPeakAt > 0) {
      float interval = nowMs - lastPeakAt;
      float instant = 60000.0f / interval;
      if (instant > 30 && instant < 220) {
        bpm = bpm == 0 ? instant : bpm * 0.7f + instant * 0.3f;
        beats++;
      }
    }
    lastPeakAt = nowMs;
    beatHigh = true;
  } else if (beatHigh && delta < 0) {
    beatHigh = false;
  }

  sensors_event_t event;
  accel.getEvent(&event);
  float g = magnitudeG(event.acceleration.x, event.acceleration.y, event.acceleration.z);
  float excess = fabsf(g - 1.0f);
  motionSum += excess;
  motionN++;
  if (g < FALL_DIP_G) sawDip = true;
  if (sawDip && g > FALL_SPIKE_G) {
    fallLatched = true;
    sawDip = false;
  }

  if (millis() - lastEmit < 1000) return;
  lastEmit = millis();
  float motion = motionN ? motionSum / motionN : 0;
  const char *activity = motion > 0.35f ? "active" : motion > 0.12f ? "light" : "rest";
  float quality = amplitude > 30 ? 0.95f : amplitude > 12 ? 0.6f : 0.05f;
  float skin = bmp.readTemperature();
  bool fall = fallLatched;
  fallLatched = false;
  motionSum = 0;
  motionN = 0;
  beats = 0;

  Serial.print("{\"ts\":");
  Serial.print(millis());
  Serial.print(",\"bpm\":");
  if (quality < 0.2f) Serial.print("null");
  else Serial.print(bpm, 1);
  Serial.print(",\"ibiMs\":[],\"signalQuality\":");
  Serial.print(quality, 2);
  Serial.print(",\"activity\":\"");
  Serial.print(activity);
  Serial.print("\",\"motionMag\":");
  Serial.print(motion, 3);
  Serial.print(",\"fallDetected\":");
  Serial.print(fall ? "true" : "false");
  Serial.print(",\"skinTempC\":");
  Serial.print(skin, 2);
  Serial.print(",\"spo2\":null,\"spo2Simulated\":true}");
  Serial.println();
}
