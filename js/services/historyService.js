import { db, ref, set, get } from './firebaseService.js';
import { toast } from '../utils.js';

const HistoryService = {
  // Save a single data point to history
  async saveDataPoint(deviceId, deviceType, data) {
    const timestamp = data.timestamp || data.deviceTimestamp || Date.now();
    const historyRef = ref(db, `history/${deviceType}/${deviceId}/${timestamp}`);
    try {
      await set(historyRef, {
        timestamp,
        date: new Date(timestamp).toISOString(),
        ...data
      });
      return true;
    } catch (error) {
      console.error('Error saving history:', error);
      return false;
    }
  },

  // Generate a unique key for history entry
  generateHistoryKey(originalTimestamp, distance) {
    // Use originalTimestamp and distance to create unique key
    // Sanitize to remove special characters that might cause Firebase issues
    const ts = String(originalTimestamp || Date.now());
    const dist = String(distance || 0).replace(/\./g, '_'); // Replace dots with underscores
    return `${ts}_${dist}`;
  },

  // Normalize timestamp - handle seconds, milliseconds, or relative timestamps
  normalizeTimestamp(timestamp) {
    if (!timestamp || timestamp === 0) return null;
    
    const year2000InMs = 946684800000; // Jan 1, 2000 in milliseconds
    const year2000InSeconds = 946684800; // Jan 1, 2000 in seconds
    
    // Very small numbers are likely relative/device counters
    if (timestamp < 1000000) {
      return null; // Invalid/relative timestamp
    }
    
    // If between 1M and year2000 in seconds, convert seconds to milliseconds
    if (timestamp >= 1000000 && timestamp < year2000InSeconds) {
      const converted = timestamp * 1000;
      if (converted >= year2000InMs) {
        return converted;
      }
      return null;
    }
    
    // Already in milliseconds and valid
    if (timestamp >= year2000InMs) {
      return timestamp;
    }
    
    return null;
  },

  // Sync all device readings to history with automatic calculations
  async syncDeviceReadingsToHistory(tankId, deviceType, readings, tank = null) {
    if (!readings || readings.length === 0) {
      console.log('⚠️ No readings to sync');
      return { synced: 0, skipped: 0 };
    }
    
    try {
      console.log(`🔄 Starting sync for tank ${tankId} with ${readings.length} readings`);
      
      // Get existing history entries to avoid duplicates
      const existingHistory = await this.getHistoryRaw(tankId, deviceType);
      const existingKeys = new Set(
        existingHistory.map(h => {
          const ts = String(h.originalTimestamp || h.deviceTimestamp || h.timestamp || '');
          const dist = String(h.distance || '');
          return `${ts}_${dist}`;
        })
      );
      
      console.log(`📊 Found ${existingHistory.length} existing entries, checking for duplicates...`);
      
      // Sort readings chronologically
      const sortedReadings = [...readings].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
      
      let syncedCount = 0;
      let skippedCount = 0;
      const savePromises = [];
      
      // Process each reading
      for (let index = 0; index < sortedReadings.length; index++) {
        const reading = sortedReadings[index];
        const rawTimestamp = reading.timestamp || 0;
        const distance = reading.distance;
        
        if (!rawTimestamp) {
          skippedCount++;
          continue;
        }
        
        // Check for duplicate
        const uniqueKey = `${rawTimestamp}_${distance || 0}`;
        if (existingKeys.has(uniqueKey)) {
          skippedCount++;
          continue;
        }
        
        // Normalize timestamp
        let normalizedTimestamp = this.normalizeTimestamp(rawTimestamp);
        
        // If invalid timestamp, assign based on reading order
        if (!normalizedTimestamp || normalizedTimestamp < 946684800000) {
          const totalReadings = sortedReadings.length;
          const reverseIndex = totalReadings - 1 - index; // 0 = oldest, last = newest
          const minutesBetweenReadings = 5;
          const offsetMinutes = reverseIndex * minutesBetweenReadings;
          normalizedTimestamp = Date.now() - (offsetMinutes * 60 * 1000);
        }
        
        // Build history entry with all data
        const historyEntry = {
          // Device data
          distance: distance,
          distance_meters: distance,
          distance_cm: distance ? (distance * 100).toFixed(1) : null,
          originalTimestamp: rawTimestamp,
          deviceTimestamp: rawTimestamp,
          timestamp: normalizedTimestamp,
          date: new Date(normalizedTimestamp).toISOString(),
          
          // Spread any other reading properties
          ...reading
        };
        
        // Calculate tank metrics if tank provided
        if (tank && distance !== undefined && distance !== null) {
          const sensorHeight = tank.sensorHeight || tank.height || 10;
          const waterLevel = Math.max(0, Math.min(sensorHeight, sensorHeight - distance));
          
          // Calculate volume based on tank shape
          let currentVolume = 0;
          if (tank.shape === 'cylinder' && tank.diameter) {
            const radius = tank.diameter / 2;
            currentVolume = Math.PI * Math.pow(radius, 2) * waterLevel * 1000;
          } else if (tank.shape === 'cuboid' && tank.length && tank.breadth) {
            currentVolume = tank.length * tank.breadth * waterLevel * 1000;
          } else {
            const maxCapacity = tank.capacity || 20000;
            const maxHeight = tank.height || 10;
            currentVolume = (waterLevel / maxHeight) * maxCapacity;
          }
          
          // Add calculated metrics
          historyEntry.waterLevel = waterLevel;
          historyEntry.currentVolume = Math.round(currentVolume);
          historyEntry.capacity = tank.capacity || 20000;
          historyEntry.shape = tank.shape;
          historyEntry.diameter = tank.diameter;
          historyEntry.length = tank.length;
          historyEntry.breadth = tank.breadth;
          historyEntry.height = tank.height;
          historyEntry.sensorHeight = sensorHeight;
        }
        
        // Generate unique Firebase key
        const historyKey = this.generateHistoryKey(rawTimestamp, distance);
        const historyRef = ref(db, `history/${deviceType}/${tankId}/${historyKey}`);
        
        // Add to save promises
        savePromises.push(
          set(historyRef, historyEntry).then(() => {
            syncedCount++;
            return true;
          }).catch(err => {
            console.error(`Error saving reading ${historyKey}:`, err);
            return false;
          })
        );
      }
      
      // Wait for all saves to complete
      await Promise.all(savePromises);
      
      console.log(`✅ Sync complete: ${syncedCount} synced, ${skippedCount} skipped`);
      
      // Verify data was saved
      if (syncedCount > 0) {
        const verifyHistory = await this.getHistoryRaw(tankId, deviceType);
        console.log(`✓ Verification: ${verifyHistory.length} total entries now in history`);
      }
      
      return { synced: syncedCount, skipped: skippedCount };
    } catch (error) {
      console.error('❌ Error syncing device readings to history:', error);
      return { synced: 0, skipped: 0, error: error.message };
    }
  },

  // Get raw history data (no filtering, no normalization)
  async getHistoryRaw(deviceId, deviceType) {
    try {
      const historyRef = ref(db, `history/${deviceType}/${deviceId}`);
      const snapshot = await get(historyRef);
      
      if (!snapshot.exists()) {
        return [];
      }
      
      const rawData = snapshot.val();
      return Object.values(rawData);
    } catch (error) {
      console.error('Error fetching raw history:', error);
      return [];
    }
  },

  // Get history with filtering and normalization
  async getHistory(deviceId, deviceType, startDate = null, endDate = null) {
    try {
      console.log(`🔍 Fetching history for ${deviceType}/${deviceId}`);
      
      const historyRef = ref(db, `history/${deviceType}/${deviceId}`);
      const snapshot = await get(historyRef);
      
      if (!snapshot.exists()) {
        console.log(`📭 No history found at: history/${deviceType}/${deviceId}`);
        return [];
      }

      const rawData = snapshot.val();
      const totalKeys = Object.keys(rawData).length;
      console.log(`📦 Found ${totalKeys} history entries`);
      
      // Convert to array
      let history = Object.values(rawData);
      
      // Normalize timestamps
      history = history.map(h => {
        let normalizedTs = this.normalizeTimestamp(h.timestamp || h.originalTimestamp || h.deviceTimestamp);
        
        if (!normalizedTs || normalizedTs < 946684800000) {
          if (h.timestamp && h.timestamp > 946684800000) {
            normalizedTs = h.timestamp;
          } else {
            normalizedTs = h.timestamp || Date.now();
          }
        }
        
        return {
          ...h,
          timestamp: normalizedTs,
          sortKey: h.originalTimestamp || h.deviceTimestamp || h.timestamp || 0
        };
      }).filter(h => h.timestamp);
      
      console.log(`📊 After normalization: ${history.length} entries`);
      
      // Check if timestamps are valid
      const hasValidTimestamps = history.some(h => h.timestamp > 946684800000);
      
      // Apply date filtering only if timestamps are valid
      if (hasValidTimestamps) {
        if (startDate) {
          const startTime = startDate instanceof Date ? startDate.getTime() : new Date(startDate + 'T00:00:00').getTime();
          const before = history.length;
          history = history.filter((h) => h.timestamp >= startTime);
          console.log(`📅 Start date filter: ${before} → ${history.length}`);
        }
        if (endDate) {
          const endTime = endDate instanceof Date ? endDate.getTime() + 86400000 : new Date(endDate + 'T23:59:59').getTime();
          const before = history.length;
          history = history.filter((h) => h.timestamp <= endTime);
          console.log(`📅 End date filter: ${before} → ${history.length}`);
        }
      } else {
        console.log(`⚠️ Using relative timestamps - showing all data`);
      }

      // Sort by timestamp (newest first)
      const sorted = history.sort((a, b) => {
        if (a.sortKey && b.sortKey && a.sortKey < 1000000 && b.sortKey < 1000000) {
          return b.sortKey - a.sortKey;
        }
        return b.timestamp - a.timestamp;
      });
      
      console.log(`✅ Returning ${sorted.length} history entries`);
      
      return sorted;
    } catch (error) {
      console.error('❌ Error fetching history:', error);
      return [];
    }
  },

  exportToCSV(history, deviceName, deviceType) {
    if (history.length === 0) {
      toast('⚠️ No history data to export');
      return;
    }

    const safeNumber = (value, decimals = 0) => {
      if (value === undefined || value === null || isNaN(value) || !isFinite(value)) {
        return '';
      }
      return Number(value).toFixed(decimals);
    };

    let headers;
    let rowMapper;

    if (deviceType === 'tanks') {
      headers = [
        'Date',
        'Time',
        'Distance (m)',
        'Distance (cm)',
        'Water Level (m)',
        'Volume (L)',
        'Main Flow Rate (L/min)',
        'Household Supply (count)',
        'Pressure (PSI)',
        'Valve States'
      ];

      rowMapper = (h) => {
        const dateObj = new Date(h.timestamp || Date.now());
        const dateStr = dateObj.toLocaleDateString('en-IN');
        const timeStr = dateObj.toLocaleTimeString('en-IN');
        const valveStatesStr = h.valveStates
          ? h.valveStates.map((v) => `${v.name}:${v.state}`).join('; ')
          : 'No data';

        return [
          dateStr,
          timeStr,
          safeNumber(h.distance, 3),
          safeNumber(h.distance_cm, 1),
          safeNumber(h.waterLevel, 2),
          safeNumber(h.currentVolume, 0),
          safeNumber(h.mainFlowRate, 2),
          h.householdSupply || 0,
          safeNumber(h.pressureChange, 1),
          `"${valveStatesStr}"`
        ];
      };
    } else {
      headers = [
        'Timestamp',
        'Date',
        'Valve State',
        'Control Status',
        'Supply Flow (L/min)',
        'Avg Supply/HH (L/min)',
        'Total Households',
        'Households Served',
        'Battery (%)',
        'Pressure (PSI)',
        'Changes'
      ];

      rowMapper = (h) => [
        h.timestamp || '',
        h.date || new Date(h.timestamp || Date.now()).toLocaleString(),
        h.valveState || 'unknown',
        h.active ? 'CLOSED' : 'OPEN',
        safeNumber(h.supplyFlow, 2),
        safeNumber(h.avgSupplyPerHousehold, 2),
        h.households || '',
        h.householdsServed || 0,
        safeNumber(h.battery, 0),
        safeNumber(h.pressure, 1),
        `"${(h.changes || 'No changes').replace(/"/g, '""')}"`
      ];
    }

    const csvContent = [headers.join(','), ...history.map((h) => rowMapper(h).join(','))].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${deviceName.replace(/[^a-z0-9]/gi, '_')}-history-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast('✓ History exported to CSV');
  }
};

export { HistoryService };
