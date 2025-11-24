import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import {
  getDatabase,
  ref,
  set,
  get,
  update,
  remove,
  onValue,
  off
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js';

import { firebaseConfig } from '../firebaseConfig.js';
import { Tank, Valve, Pipeline } from '../models.js';
import { toast, updateConnectionStatus } from '../utils.js';

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

const FirebaseService = {
  listeners: [],

  async saveTank(tank) {
    try {
      await set(ref(db, `tanks/${tank.id}`), tank.toFirebase());
      return true;
    } catch (error) {
      console.error('Error saving tank:', error);
      toast('❌ Failed to save tank');
      return false;
    }
  },

  async saveValve(valve) {
    try {
      await set(ref(db, `valves/${valve.id}`), valve.toFirebase());
      return true;
    } catch (error) {
      console.error('Error saving valve:', error);
      toast('❌ Failed to save valve');
      return false;
    }
  },

  async savePipeline(pipeline) {
    try {
      await set(ref(db, `pipelines/${pipeline.id}`), pipeline.toFirebase());
      return true;
    } catch (error) {
      console.error('Error saving pipeline:', error);
      toast('❌ Failed to save pipeline');
      return false;
    }
  },

  async deleteTank(id) {
    try {
      await remove(ref(db, `tanks/${id}`));
      return true;
    } catch (error) {
      console.error(error);
      return false;
    }
  },

  async deleteValve(id) {
    try {
      await remove(ref(db, `valves/${id}`));
      return true;
    } catch (error) {
      console.error(error);
      return false;
    }
  },

  async deletePipeline(id) {
    try {
      await remove(ref(db, `pipelines/${id}`));
      return true;
    } catch (error) {
      console.error(error);
      return false;
    }
  },

  listenToTanks(callback) {
    const tanksRef = ref(db, 'tanks');
    onValue(
      tanksRef,
      (snapshot) => {
        const data = snapshot.val();
        const tankList = data ? Object.values(data).map((t) => new Tank(t)) : [];
        callback(tankList);
      },
      (error) => {
        console.error('Error listening to tanks:', error);
        updateConnectionStatus(false);
      }
    );
    this.listeners.push({ ref: tanksRef, unsubscribe: () => off(tanksRef) });
  },

  listenToValves(callback) {
    const valvesRef = ref(db, 'valves');
    onValue(
      valvesRef,
      (snapshot) => {
        const data = snapshot.val();
        const valveList = data ? Object.values(data).map((v) => new Valve(v)) : [];
        callback(valveList);
      },
      (error) => {
        console.error('Error listening to valves:', error);
        updateConnectionStatus(false);
      }
    );
    this.listeners.push({ ref: valvesRef, unsubscribe: () => off(valvesRef) });
  },

  listenToPipelines(callback) {
    const pipelinesRef = ref(db, 'pipelines');
    onValue(
      pipelinesRef,
      (snapshot) => {
        const data = snapshot.val();
        const pipelineList = data ? Object.values(data).map((p) => new Pipeline(p)) : [];
        callback(pipelineList);
      },
      (error) => {
        console.error('Error listening to pipelines:', error);
        updateConnectionStatus(false);
      }
    );
    this.listeners.push({ ref: pipelinesRef, unsubscribe: () => off(pipelinesRef) });
  },

  listenToAnalytics(callback) {
    const analyticsRef = ref(db, 'analytics');
    onValue(
      analyticsRef,
      (snapshot) => {
        callback(snapshot.val() || null);
      },
      (error) => {
        console.error('Error listening to analytics:', error);
      }
    );
    this.listeners.push({ ref: analyticsRef, unsubscribe: () => off(analyticsRef) });
  },

  // Extract all readings from a device node (for history sync)
  extractAllReadings(deviceNode) {
    if (!deviceNode || typeof deviceNode !== 'object') return [];
    
    const readings = [];
    
    // Check if this is a flat structure (direct distance/timestamp)
    if (deviceNode.distance !== undefined || deviceNode.timestamp !== undefined) {
      readings.push({
        distance: deviceNode.distance,
        distance_meters: deviceNode.distance,
        timestamp: deviceNode.timestamp,
        ...deviceNode
      });
      return readings;
    }
    
    // Check for nested structure with push-key children
    Object.keys(deviceNode).forEach(key => {
      const child = deviceNode[key];
      // Check if this child is a reading (has distance/timestamp)
      if (child && typeof child === 'object' && 
          (child.distance !== undefined || child.timestamp !== undefined)) {
        readings.push({
          distance: child.distance,
          distance_meters: child.distance,
          timestamp: child.timestamp,
          pushKey: key, // Keep track of the push key for reference
          ...child
        });
      }
    });
    
    return readings.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)); // Sort by timestamp descending
  },

  listenToDevices(callback) {
    // Helper function to extract latest reading from a device node
    const extractLatestReading = (deviceNode) => {
      if (!deviceNode || typeof deviceNode !== 'object') return null;
      
      // Check if this is a flat structure (direct distance/timestamp)
      if (deviceNode.distance !== undefined || deviceNode.timestamp !== undefined) {
        return {
          distance: deviceNode.distance,
          distance_meters: deviceNode.distance,
          timestamp: deviceNode.timestamp,
          ...deviceNode
        };
      }
      
      // Check for nested structure with push-key children
      let latestReading = null;
      let latestTimestamp = -1;
      
      Object.keys(deviceNode).forEach(key => {
        const child = deviceNode[key];
        // Check if this child is a reading (has distance/timestamp)
        if (child && typeof child === 'object' && 
            (child.distance !== undefined || child.timestamp !== undefined)) {
          const timestamp = child.timestamp || 0;
          // Get the reading with the highest timestamp (most recent)
          if (timestamp > latestTimestamp) {
            latestTimestamp = timestamp;
            latestReading = child;
          }
        }
      });
      
      if (latestReading) {
        return {
          distance: latestReading.distance,
          distance_meters: latestReading.distance,
          timestamp: latestReading.timestamp,
          ...latestReading
        };
      }
      
      return null;
    };
    
    // Known non-device paths to skip
    const skipPaths = ['tanks', 'valves', 'pipelines', 'analytics', 'ultrasonic', 'history'];
    
    // Listen to device data at root level (DEVICE_001, DEVICE_002, etc.)
    // Structure: DEVICE_001/{pushKey1: {distance, timestamp}, pushKey2: {distance, timestamp}, ...}
    const devicesRef = ref(db);
    onValue(
      devicesRef,
      (snapshot) => {
        const data = snapshot.val() || {};
        const normalized = {};
        
        // Process root-level device nodes
        Object.keys(data).forEach(deviceId => {
          // Skip known non-device paths
          if (skipPaths.includes(deviceId)) return;
          
          // Check if this looks like a device ID (starts with DEVICE_ or similar pattern)
          // Also accept any node that has device-like structure
          const deviceNode = data[deviceId];
          const reading = extractLatestReading(deviceNode);
          
          if (reading) {
            normalized[deviceId] = {
              id: deviceId,
              ...reading
            };
          }
        });
        
        // Also check /ultrasonic path for backward compatibility
        if (data.ultrasonic && typeof data.ultrasonic === 'object') {
          Object.keys(data.ultrasonic).forEach(deviceId => {
            const reading = extractLatestReading(data.ultrasonic[deviceId]);
            if (reading) {
              normalized[deviceId] = {
                id: deviceId,
                ...reading
              };
            }
          });
        }
        
        if (Object.keys(normalized).length > 0) {
          console.log(`📡 Found ${Object.keys(normalized).length} device(s) with telemetry data:`, Object.keys(normalized));
        }
        
        // Store raw device data for history sync
        this.lastDeviceRawData = data;
        
        callback(normalized);
      },
      (error) => {
        console.error('Error listening to devices:', error);
        updateConnectionStatus(false);
      }
    );
    this.listeners.push({ ref: devicesRef, unsubscribe: () => off(devicesRef) });
  },

  // Fetch all device data directly from Firebase (one-time fetch)
  async fetchAllDeviceData() {
    try {
      const devicesRef = ref(db);
      const snapshot = await get(devicesRef);
      if (!snapshot.exists()) {
        console.log('📭 No device data found in Firebase');
        return {};
      }
      
      const data = snapshot.val() || {};
      const skipPaths = ['tanks', 'valves', 'pipelines', 'analytics', 'ultrasonic', 'history'];
      const deviceData = {};
      
      // Process root-level device nodes
      Object.keys(data).forEach(deviceId => {
        if (skipPaths.includes(deviceId)) return;
        const deviceNode = data[deviceId];
        if (deviceNode && typeof deviceNode === 'object') {
          deviceData[deviceId] = deviceNode;
        }
      });
      
      // Also check /ultrasonic path
      if (data.ultrasonic && typeof data.ultrasonic === 'object') {
        Object.keys(data.ultrasonic).forEach(deviceId => {
          deviceData[deviceId] = data.ultrasonic[deviceId];
        });
      }
      
      console.log(`📡 Fetched data for ${Object.keys(deviceData).length} device(s)`);
      return deviceData;
    } catch (error) {
      console.error('Error fetching device data:', error);
      return {};
    }
  },

  async clearAll() {
    try {
      await set(ref(db, 'tanks'), null);
      await set(ref(db, 'valves'), null);
      await set(ref(db, 'pipelines'), null);
      return true;
    } catch (error) {
      console.error('Error clearing data:', error);
      return false;
    }
  },

  detachListeners() {
    this.listeners.forEach((listener) => listener.unsubscribe());
    this.listeners = [];
  }
};

export {
  FirebaseService,
  db,
  ref,
  set,
  get,
  update,
  remove,
  onValue,
  off
};

