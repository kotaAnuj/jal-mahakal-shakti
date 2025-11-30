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
    const ts = String(originalTimestamp || Date.now());
    const dist = String(distance || 0).replace(/\./g, '_');
    return `${ts}_${dist}`;
  },

  // Normalize timestamp - handle seconds, milliseconds, or relative timestamps
  normalizeTimestamp(timestamp) {
    if (!timestamp || timestamp === 0) return null;
    
    const year2000InMs = 946684800000;
    const year2000InSeconds = 946684800;
    
    if (timestamp < 1000000) {
      return null;
    }
    
    if (timestamp >= 1000000 && timestamp < year2000InSeconds) {
      const converted = timestamp * 1000;
      if (converted >= year2000InMs) {
        return converted;
      }
      return null;
    }
    
    if (timestamp >= year2000InMs) {
      return timestamp;
    }
    
    return null;
  },

  // 🔥 NEW: Find the latest timestamp in existing history
  getLatestTimestamp(existingHistory) {
    if (!existingHistory || existingHistory.length === 0) {
      return 0; // No history, start from beginning
    }
    
    let maxTimestamp = 0;
    for (const entry of existingHistory) {
      const ts = entry.originalTimestamp || entry.deviceTimestamp || entry.timestamp || 0;
      if (ts > maxTimestamp) {
        maxTimestamp = ts;
      }
    }
    
    console.log(`📍 Latest existing timestamp: ${maxTimestamp}`);
    return maxTimestamp;
  },

  // 🔥 FIXED: Only sync NEW readings (incremental sync)
  async syncDeviceReadingsToHistory(tankId, deviceType, readings, tank = null) {
    if (!readings || readings.length === 0) {
      console.log('⚠️ No readings to sync');
      return { synced: 0, skipped: 0 };
    }
    
    try {
      console.log(`🔄 Starting incremental sync for tank ${tankId} with ${readings.length} readings`);
      
      // Get existing history ONCE
      const existingHistory = await this.getHistoryRaw(tankId, deviceType);
      console.log(`📊 Found ${existingHistory.length} existing entries`);
      
      // 🔥 CRITICAL FIX: Find the latest timestamp we already have
      const latestExistingTimestamp = this.getLatestTimestamp(existingHistory);
      
      // 🔥 CRITICAL FIX: Filter to only NEW readings
      const newReadings = readings.filter(reading => {
        const ts = reading.timestamp || 0;
        return ts > latestExistingTimestamp; // Only process readings AFTER our latest
      });
      
      console.log(`🎯 Filtered to ${newReadings.length} NEW readings (skipping ${readings.length - newReadings.length} existing)`);
      
      if (newReadings.length === 0) {
        console.log('✅ No new readings to sync - all data is up to date');
        return { synced: 0, skipped: readings.length };
      }
      
      // Create a Set for duplicate checking (only for NEW readings)
      const existingKeys = new Set(
        existingHistory.map(h => {
          const ts = String(h.originalTimestamp || h.deviceTimestamp || h.timestamp || '');
          const dist = String(h.distance || '');
          return `${ts}_${dist}`;
        })
      );
      
      // Sort NEW readings chronologically
      const sortedReadings = [...newReadings].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
      
      let syncedCount = 0;
      let skippedCount = 0;
      
      // 🔥 OPTIMIZED: Process 20 batches per minute (3 seconds between batches)
      const CHUNK_SIZE = 20;
      const DELAY_BETWEEN_BATCHES = 3000; // 3 seconds = 20 batches/minute
      const chunks = [];
      for (let i = 0; i < sortedReadings.length; i += CHUNK_SIZE) {
        chunks.push(sortedReadings.slice(i, i + CHUNK_SIZE));
      }
      
      console.log(`📦 Processing ${chunks.length} batches of ${CHUNK_SIZE} readings (20 batches/min)`);
      console.log(`⏱️ Estimated time: ${Math.ceil((chunks.length * DELAY_BETWEEN_BATCHES) / 1000)} seconds`);
      
      // Process each batch with 3-second delays
      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
        const chunk = chunks[chunkIndex];
        const savePromises = [];
        
        for (let index = 0; index < chunk.length; index++) {
          const reading = chunk[index];
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
          
          if (!normalizedTimestamp || normalizedTimestamp < 946684800000) {
            const totalReadings = sortedReadings.length;
            const globalIndex = chunkIndex * CHUNK_SIZE + index;
            const reverseIndex = totalReadings - 1 - globalIndex;
            const minutesBetweenReadings = 5;
            const offsetMinutes = reverseIndex * minutesBetweenReadings;
            normalizedTimestamp = Date.now() - (offsetMinutes * 60 * 1000);
          }
          
          // Build history entry
          const safeDistance = (distance === undefined ? null : distance);

          const historyEntry = {
            distance: safeDistance,
            distance_meters: safeDistance,
            distance_cm: safeDistance !== null ? (safeDistance * 100).toFixed(1) : null,
            originalTimestamp: rawTimestamp,
            deviceTimestamp: rawTimestamp,
            timestamp: normalizedTimestamp,
            date: new Date(normalizedTimestamp).toISOString(),
            ...Object.fromEntries(
              Object.entries(reading).map(([k, v]) => [k, v === undefined ? null : v])
            )
          };
          
          // Calculate tank metrics if tank provided
          if (tank && distance !== undefined && distance !== null) {
            const sensorHeight = tank.sensorHeight || tank.height || 10;
            const waterLevel = Math.max(0, Math.min(sensorHeight, sensorHeight - distance));
            
            let currentVolume = 0;
            let maxCapacity = 0;

            if (tank.shape === 'cylinder' && tank.diameter) {
              const radius = tank.diameter / 2;
              currentVolume = Math.PI * Math.pow(radius, 2) * waterLevel * 1000;
              maxCapacity = Math.PI * Math.pow(radius, 2) * tank.height * 1000;
            } else if (tank.shape === 'cuboid' && tank.length && tank.breadth) {
              currentVolume = tank.length * tank.breadth * waterLevel * 1000;
              maxCapacity = tank.length * tank.breadth * tank.height * 1000;
            } else {
              maxCapacity = tank.capacity || 20000;
              const maxHeight = tank.height || 10;
              currentVolume = (waterLevel / maxHeight) * maxCapacity;
            }

            const fillPercentage = maxCapacity > 0 ? (currentVolume / maxCapacity) * 100 : 0;

            historyEntry.waterLevel = parseFloat(waterLevel.toFixed(3));
            historyEntry.currentVolume = Math.round(currentVolume);
            historyEntry.maxCapacity = Math.round(maxCapacity);
            historyEntry.fillPercentage = parseFloat(fillPercentage.toFixed(2));
            historyEntry.capacity = tank.capacity || Math.round(maxCapacity);
          }
          
          // Generate unique Firebase key
          const historyKey = this.generateHistoryKey(rawTimestamp, distance);
          const historyRef = ref(db, `history/${deviceType}/${tankId}/${historyKey}`);
          
          // Add to save promises for this chunk
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
        
        // Wait for this batch to complete
        await Promise.all(savePromises);
        
        // 🔥 CRITICAL: 3-second delay between batches (20 batches/minute)
        // This gives time for UI to reload and display updated data
        if (chunkIndex < chunks.length - 1) {
          console.log(`⏳ Batch ${chunkIndex + 1}/${chunks.length} complete (${syncedCount} synced). Waiting 3s before next batch...`);
          await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
        } else {
          console.log(`✅ Final batch ${chunkIndex + 1}/${chunks.length} complete (${syncedCount} synced)`);
        }
      }
      
      console.log(`✅ Sync complete: ${syncedCount} NEW entries synced, ${skippedCount} duplicates skipped`);
      
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

  // Get history with efficient filtering
  async getHistory(deviceId, deviceType, startDate = null, endDate = null) {
    try {
      console.log(`🔍 Fetching history for ${deviceType}/${deviceId}`);
      
      const historyRef = ref(db, `history/${deviceType}/${deviceId}`);
      const snapshot = await get(historyRef);
      
      if (!snapshot.exists()) {
        console.log(`🔭 No history found at: history/${deviceType}/${deviceId}`);
        return [];
      }

      const rawData = snapshot.val();
      const totalKeys = Object.keys(rawData).length;
      console.log(`📦 Found ${totalKeys} history entries`);
      
      // Process in single pass
      let history = [];
      const startTime = startDate ? (startDate instanceof Date ? startDate.getTime() : new Date(startDate + 'T00:00:00').getTime()) : null;
      const endTime = endDate ? (endDate instanceof Date ? endDate.getTime() + 86400000 : new Date(endDate + 'T23:59:59').getTime()) : null;
      
      // Single loop instead of multiple filters
      for (const entry of Object.values(rawData)) {
        let normalizedTs = this.normalizeTimestamp(entry.timestamp || entry.originalTimestamp || entry.deviceTimestamp);
        
        if (!normalizedTs || normalizedTs < 946684800000) {
          if (entry.timestamp && entry.timestamp > 946684800000) {
            normalizedTs = entry.timestamp;
          } else {
            normalizedTs = entry.timestamp || Date.now();
          }
        }
        
        if (!normalizedTs) continue;
        
        // Apply filters inline
        if (startTime && normalizedTs < startTime) continue;
        if (endTime && normalizedTs > endTime) continue;
        
        history.push({
          ...entry,
          timestamp: normalizedTs,
          sortKey: entry.originalTimestamp || entry.deviceTimestamp || entry.timestamp || 0
        });
      }
      
      console.log(`📊 After filtering: ${history.length} entries`);
      
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
    toast('✔ History exported to CSV');
  }
};

export { HistoryService };