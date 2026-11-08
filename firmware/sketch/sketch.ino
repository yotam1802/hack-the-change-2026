const int sensorPin = A0;

float baseline = 0;
float smoothValue = 0;

float threshold = 0.9;

bool pulseDetected = false;

unsigned long lastBeatTime = 0;

unsigned long intervals[5];
int intervalIndex = 0;
int intervalCount = 0;

int BPM = 0;

void setup() {
  Serial.begin(9600);

  // Initialize baseline
  baseline = analogRead(sensorPin);
  smoothValue = baseline;

  Serial.println("HW-827 Heart Rate Monitor");
  Serial.println("Place finger on sensor...");
}

void loop() {

  unsigned long currentTime = millis();

  int rawValue = analogRead(sensorPin);

  // Smooth sensor signal
  smoothValue = (0.8 * smoothValue) + (0.2 * rawValue);

  // Slowly adjust baseline
  baseline = (0.995 * baseline) + (0.005 * smoothValue);

  // Calculate signal above baseline
  float signal = smoothValue - baseline;

  // Detect heartbeat peak
  if (signal > threshold && !pulseDetected) {

    unsigned long interval = currentTime - lastBeatTime;

    if (lastBeatTime != 0 && interval >= 300 && interval <= 2000) {

      intervals[intervalIndex] = interval;

      intervalIndex = (intervalIndex + 1) % 5;

      if (intervalCount < 5) {
        intervalCount++;
      }

      unsigned long total = 0;

      for (int i = 0; i < intervalCount; i++) {
        total += intervals[i];
      }

      BPM = 60000 / (total / intervalCount);

      Serial.print("Heart Rate: ");
      Serial.print(BPM);
      Serial.println(" BPM");
    }

    lastBeatTime = currentTime;
    pulseDetected = true;
  }

  // Reset detection after signal drops
  if (signal < threshold * 0.4) {
    pulseDetected = false;
  }

  // Reset when no beats are detected
  if (currentTime - lastBeatTime > 3000) {
    BPM = 0;
    intervalCount = 0;
    intervalIndex = 0;
  }

  delay(10);
}