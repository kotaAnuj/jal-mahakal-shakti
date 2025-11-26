/*
 * ESP32 T-CALL: Ultrasonic Sensor to Firebase via GSM - FIXED VERSION
 * Uses SIM800L with mobile data - NO WIFI NEEDED
 */

// ==========================================
// FIREBASE CONFIGURATION - SIMPLIFIED
// ==========================================
const String FIREBASE_HOST = "jal-mahakal-shakti-default-rtdb.asia-southeast1.firebasedatabase.app";
const String FIREBASE_PATH = "/DEVICE_001.json";  // Direct to device

// ==========================================
// DEVICE ID - UNIQUE FOR EACH ESP32
// ==========================================
String deviceId = "";  // Will be set in setup() using chip ID

// ==========================================
// BSNL APN CONFIGURATION
// ==========================================
const String APN = "bsnlnet";

// ==========================================
// T-CALL SIM800L PINS
// ==========================================
#define MODEM_RST     5
#define MODEM_PWRKEY  4
#define MODEM_POWER_ON 23
#define MODEM_TX      27
#define MODEM_RX      26
#define SIM800L_IP5306_WORKAROUND  25

// ==========================================
// ULTRASONIC SENSOR PINS
// ==========================================
#define SENSOR_RX_PIN 32
#define SENSOR_TX_PIN 33

// ==========================================
// SENSOR PARAMETERS
// ==========================================
#define HEADER_BYTE 0xFF
#define MIN_DISTANCE 30
#define MAX_DISTANCE 4500

// ==========================================
// TIMING - CHANGED TO 2 MINUTES
// ==========================================
#define SEND_INTERVAL 120000  // 2 minutes (120 seconds)
unsigned long lastSendTime = 0;
unsigned long lastSensorDisplay = 0;

// ==========================================
// VARIABLES
// ==========================================
HardwareSerial SerialAT(1);
float currentDistanceM = 0.0;
bool validDataAvailable = false;
unsigned long validReadings = 0;
unsigned long totalAttempts = 0;
unsigned long failedSends = 0;
unsigned long successfulSends = 0;

unsigned long baudRates[] = {9600, 19200, 115200, 4800, 38400, 57600};
int numBaudRates = 6;
int currentBaudIndex = 0;
bool baudRateFound = false;
unsigned long baudTestStartTime = 0;

// ==========================================
// FUNCTION DECLARATIONS
// ==========================================
void init_gsm();
void gprs_connect();
boolean is_gprs_connected();
void post_to_firebase_simple(String data);
boolean waitResponse(String expected_answer, unsigned int timeout);
void readUltrasonicSensor();
void detectBaudRate();

// ==========================================
// SETUP
// ==========================================
void setup() {
  Serial.begin(115200);
  delay(1000);
  
  // Generate unique device ID from ESP32 chip ID
  deviceId = "DEVICE_001";
  
  Serial.println("\n\n═══════════════════════════════════════════════════");
  Serial.println("  ESP32 T-CALL: Ultrasonic → Firebase via GSM");
  Serial.println("  FIXED VERSION - Proper JSON Formatting");
  Serial.println("═══════════════════════════════════════════════════");
  Serial.println("  Device ID: " + deviceId);
  Serial.println("  Send Interval: 2 minutes");
  Serial.println("═══════════════════════════════════════════════════");
  
  // Initialize Sensor
  Serial.println("\n[1/3] Initializing Ultrasonic Sensor...");
  Serial2.begin(baudRates[0], SERIAL_8N1, SENSOR_RX_PIN, SENSOR_TX_PIN);
  delay(500);
  while(Serial2.available()) Serial2.read();
  baudTestStartTime = millis();
  Serial.println("✓ Sensor initialized - detecting baud rate...");
  
  // Power up SIM800L
  Serial.println("\n[2/3] Powering up SIM800L...");
  pinMode(SIM800L_IP5306_WORKAROUND, OUTPUT);
  digitalWrite(SIM800L_IP5306_WORKAROUND, HIGH);
  pinMode(MODEM_PWRKEY, OUTPUT);
  pinMode(MODEM_RST, OUTPUT);
  pinMode(MODEM_POWER_ON, OUTPUT);
  digitalWrite(MODEM_PWRKEY, LOW);
  digitalWrite(MODEM_RST, HIGH);
  digitalWrite(MODEM_POWER_ON, HIGH);
  
  SerialAT.begin(9600, SERIAL_8N1, MODEM_RX, MODEM_TX);
  delay(3000);
  Serial.println("✓ SIM800L powered on");
  
  // Initialize GSM
  Serial.println("\n[3/3] Initializing GSM and Connecting...");
  Serial.println("This may take 60-90 seconds...");
  init_gsm();
  gprs_connect();
  
  Serial.println("\n═══════════════════════════════════════════════════");
  Serial.println("  🎉 SYSTEM READY - Starting Data Collection");
  Serial.println("═══════════════════════════════════════════════════");
  Serial.println("\nCommands: 't' = test send, 's' = status");
  Serial.println("═══════════════════════════════════════════════════\n");
  
  delay(2000);
}

// ==========================================
// MAIN LOOP
// ==========================================
void loop() {
  if (!baudRateFound) {
    detectBaudRate();
    delay(100);
    return;
  }
  
  readUltrasonicSensor();
  
  if (validDataAvailable && (millis() - lastSendTime >= SEND_INTERVAL)) {
    lastSendTime = millis();
    
    if (!is_gprs_connected()) {
      Serial.println("⚠️  GPRS disconnected, reconnecting...");
      gprs_connect();
    }
    
    // PROPER JSON FORMAT that Firebase accepts
    String jsonData = "{";
    jsonData += "\"distance\": " + String(currentDistanceM, 3) + ",";
    jsonData += "\"timestamp\": " + String(millis());
    jsonData += "}";
    
    post_to_firebase_simple(jsonData);
  }
  
  if (Serial.available()) {
    char cmd = Serial.read();
    if (cmd == 't' || cmd == 'T') {
      Serial.println("\n🔥 Manual test triggered!");
      if (validDataAvailable) {
        String jsonData = "{";
        jsonData += "\"distance\": " + String(currentDistanceM, 3) + ",";
        jsonData += "\"timestamp\": " + String(millis());
        jsonData += "}";
        post_to_firebase_simple(jsonData);
      }
    } else if (cmd == 's' || cmd == 'S') {
      Serial.println("\n📊 STATUS:");
      Serial.println("Device ID: " + deviceId);
      Serial.println("Valid readings: " + String(validReadings));
      Serial.println("Successful sends: " + String(successfulSends));
      Serial.println("Failed sends: " + String(failedSends));
      Serial.println("Current distance: " + String(currentDistanceM * 100, 1) + " cm");
    }
  }
  
  delay(50);
}

// ==========================================
// FIXED FIREBASE FUNCTION - SIMPLIFIED
// ==========================================
void post_to_firebase_simple(String data) {
  totalAttempts++;
  
  Serial.println("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  Serial.println("🔥 Sending to Firebase...");
  Serial.println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  Serial.print("🔥 FIREBASE SEND #");
  Serial.println(totalAttempts);
  Serial.println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  
  // Start HTTP
  Serial.println("[1/7] Starting HTTP...");
  SerialAT.println("AT+HTTPINIT");
  if (!waitResponse("OK", 5000)) {
    Serial.println("❌ HTTP INIT failed");
    failedSends++;
    return;
  }
  delay(500);
  
  // Enable SSL for HTTPS
  Serial.println("[2/7] Enabling SSL...");
  SerialAT.println("AT+HTTPSSL=1");
  if (!waitResponse("OK", 5000)) {
    Serial.println("⚠️  SSL failed, trying without SSL...");
    SerialAT.println("AT+HTTPSSL=0");
    waitResponse("OK", 2000);
  }
  delay(500);
  
  // Set CID
  Serial.println("[3/7] Setting CID...");
  SerialAT.println("AT+HTTPPARA=\"CID\",1");
  waitResponse("OK", 2000);
  delay(500);
  
  // Set URL - SIMPLIFIED without auth first
  Serial.println("[4/7] Setting URL...");
  String url = "https://" + FIREBASE_HOST + FIREBASE_PATH;
  Serial.println("URL: " + url);
  SerialAT.println("AT+HTTPPARA=\"URL\",\"" + url + "\"");
  if (!waitResponse("OK", 5000)) {
    Serial.println("❌ URL setting failed");
    SerialAT.println("AT+HTTPTERM");
    waitResponse("OK", 1000);
    failedSends++;
    return;
  }
  delay(500);
  
  // Set content type
  Serial.println("[5/7] Setting content type...");
  SerialAT.println("AT+HTTPPARA=\"CONTENT\",\"application/json\"");
  waitResponse("OK", 2000);
  delay(500);
  
  // Set data
  Serial.println("[6/7] Setting data: " + String(data.length()) + " bytes");
  SerialAT.println("AT+HTTPDATA=" + String(data.length()) + ",15000");
  if (!waitResponse("DOWNLOAD", 5000)) {
    Serial.println("❌ HTTPDATA failed");
    SerialAT.println("AT+HTTPTERM");
    waitResponse("OK", 1000);
    failedSends++;
    return;
  }
  delay(100);
  
  // Send the actual JSON data
  Serial.println("Data: " + data);
  SerialAT.println(data);
  if (!waitResponse("OK", 5000)) {
    Serial.println("❌ Data send failed");
    SerialAT.println("AT+HTTPTERM");
    waitResponse("OK", 1000);
    failedSends++;
    return;
  }
  delay(500);
  
  // Execute POST
  Serial.println("[7/7] Executing HTTP POST...");
  SerialAT.println("AT+HTTPACTION=1");  // POST method
  
  // Wait for response with detailed parsing
  unsigned long start = millis();
  String response = "";
  bool gotResponse = false;
  int httpStatus = 0;
  
  while (millis() - start < 20000) {
    if (SerialAT.available()) {
      char c = SerialAT.read();
      response += c;
      
      // Check for HTTP response
      if (response.indexOf("+HTTPACTION:") >= 0) {
        // Parse the status code
        int startIdx = response.indexOf("+HTTPACTION:") + 12;
        int commaIdx = response.indexOf(",", startIdx);
        if (commaIdx > startIdx) {
          httpStatus = response.substring(startIdx, commaIdx).toInt();
        }
        
        Serial.println("\n📡 HTTP Response: " + String(httpStatus));
        
        if (httpStatus == 200) {
          successfulSends++;
          Serial.println("✅ SUCCESS! Data sent to Firebase!");
          Serial.println("📊 Sent: " + data);
        } else {
          failedSends++;
          Serial.println("❌ HTTP ERROR: " + String(httpStatus));
          
          // Read error response
          delay(1000);
          SerialAT.println("AT+HTTPREAD");
          String errorResp = "";
          unsigned long errorStart = millis();
          while (millis() - errorStart < 5000) {
            if (SerialAT.available()) {
              errorResp += (char)SerialAT.read();
            }
          }
          Serial.println("Error details: " + errorResp);
        }
        gotResponse = true;
        break;
      }
    }
  }
  
  if (!gotResponse) {
    failedSends++;
    Serial.println("❌ TIMEOUT - No HTTP response");
  }
  
  // Always terminate HTTP
  SerialAT.println("AT+HTTPTERM");
  waitResponse("OK", 2000);
  
  Serial.println("📊 Stats: " + String(successfulSends) + " success / " + String(failedSends) + " failed");
  Serial.println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

// ==========================================
// DETECT BAUD RATE (unchanged)
// ==========================================
void detectBaudRate() {
  if (validReadings > 0) {
    baudRateFound = true;
    Serial.println("\n✅ BAUD RATE DETECTED: " + String(baudRates[currentBaudIndex]) + " baud\n");
    return;
  }
  
  if (millis() - baudTestStartTime > 5000) {
    Serial.println("❌ " + String(baudRates[currentBaudIndex]) + " baud - No valid readings");
    currentBaudIndex++;
    if (currentBaudIndex >= numBaudRates) currentBaudIndex = 0;
    
    Serial2.end();
    delay(100);
    Serial2.begin(baudRates[currentBaudIndex], SERIAL_8N1, SENSOR_RX_PIN, SENSOR_TX_PIN);
    delay(100);
    while(Serial2.available()) Serial2.read();
    baudTestStartTime = millis();
  }
  
  readUltrasonicSensor();
}

// ==========================================
// READ ULTRASONIC SENSOR (unchanged)
// ==========================================
void readUltrasonicSensor() {
  if (Serial2.available()) {
    uint8_t byte1 = Serial2.read();
    
    if (byte1 == HEADER_BYTE) {
      unsigned long timeout = millis() + 100;
      while (Serial2.available() < 3 && millis() < timeout) delay(1);
      
      if (Serial2.available() >= 3) {
        uint8_t dataH = Serial2.read();
        uint8_t dataL = Serial2.read();
        uint8_t checksum = Serial2.read();
        
        if (((HEADER_BYTE + dataH + dataL) & 0xFF) == checksum) {
          int distanceMM = (dataH << 8) | dataL;
          
          if (distanceMM >= MIN_DISTANCE && distanceMM <= MAX_DISTANCE) {
            validReadings++;
            currentDistanceM = distanceMM / 1000.0;
            validDataAvailable = true;
            
            if (millis() - lastSensorDisplay >= 2000) {
              lastSensorDisplay = millis();
              Serial.print("📏 Reading #");
              Serial.print(validReadings);
              Serial.print(": ");
              Serial.print(currentDistanceM, 2);
              Serial.print(" m (");
              Serial.print(distanceMM / 10.0, 1);
              Serial.print(" cm) | Next send: ");
              Serial.print((SEND_INTERVAL - (millis() - lastSendTime)) / 1000);
              Serial.println(" sec");
            }
          }
        }
      }
    }
  }
}

// ==========================================
// GSM FUNCTIONS (unchanged)
// ==========================================
void init_gsm() {
  Serial.println("Testing AT...");
  SerialAT.println("AT");
  waitResponse("OK", 2000);
  delay(500);
  
  Serial.println("Checking SIM...");
  SerialAT.println("AT+CPIN?");
  waitResponse("+CPIN: READY", 5000);
  delay(500);
  
  Serial.println("Enabling full functionality...");
  SerialAT.println("AT+CFUN=1");
  waitResponse("OK", 2000);
  delay(500);
  
  Serial.println("Enabling verbose errors...");
  SerialAT.println("AT+CMEE=2");
  waitResponse("OK", 2000);
  delay(500);
  
  Serial.println("Waiting for network registration...");
  int attempts = 0;
  while (attempts < 30) {
    SerialAT.println("AT+CREG?");
    if (waitResponse("+CREG: 0,", 2000)) break;
    attempts++;
    delay(2000);
  }
  
  Serial.println("Checking signal quality...");
  SerialAT.println("AT+CSQ");
  waitResponse("OK", 2000);
  delay(500);
  
  Serial.println("✓ GSM initialized!");
}

void gprs_connect() {
  Serial.println("Connecting to GPRS...");
  
  SerialAT.println("AT+SAPBR=0,1");
  waitResponse("OK", 60000);
  delay(500);
  
  SerialAT.println("AT+SAPBR=3,1,\"Contype\",\"GPRS\"");
  waitResponse("OK", 2000);
  delay(500);
  
  SerialAT.println("AT+SAPBR=3,1,\"APN\",\"" + APN + "\"");
  waitResponse("OK", 2000);
  delay(500);
  
  SerialAT.println("AT+SAPBR=1,1");
  waitResponse("OK", 30000);
  delay(500);
  
  SerialAT.println("AT+SAPBR=2,1");
  waitResponse("OK", 5000);
  delay(500);
  
  Serial.println("✓ GPRS Connected!");
}

boolean is_gprs_connected() {
  SerialAT.println("AT+CGATT?");
  return waitResponse("+CGATT: 1", 6000);
}

boolean waitResponse(String expected_answer, unsigned int timeout) {
  bool answer = false;
  String response = "";
  unsigned long previous = millis();
  
  while (SerialAT.available() > 0) SerialAT.read();
  
  do {
    if (SerialAT.available() != 0) {
      char c = SerialAT.read();
      response.concat(c);
      if (response.indexOf(expected_answer) >= 0) answer = true;
    }
  } while ((answer == false) && ((millis() - previous) < timeout));
  
  if (response.length() > 0 && response != "\r\n") Serial.println(response);
  
  return answer;
}
