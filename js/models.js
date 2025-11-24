export class Tank {
  constructor(data) {
    Object.assign(this, {
      id: data.id,
      name: data.name || 'Tank',
      lat: parseFloat(data.lat),
      lng: parseFloat(data.lng),
      type: data.type || 'OHSR',
      capacity: parseFloat(data.capacity) || 20000,
      waterLevel: parseFloat(data.waterLevel) || 8.5,
      shape: data.shape || (data.type === 'GSR' ? 'cuboid' : 'cylinder'),
      diameter: parseFloat(data.diameter) || 10,
      height: parseFloat(data.height) || 10,
      length: parseFloat(data.length) || 10,
      breadth: parseFloat(data.breadth) || 10,
      state: data.state || 'Telangana',
      district: data.district || 'Mulugu',
      mandal: data.mandal || 'Eturunagaram',
      habitation: data.habitation || 'Ellishettypalle',
      connectedMainValves: data.connectedMainValves || [],
      deviceId: data.deviceId || null,
      sensorHeight: parseFloat(data.sensorHeight) || parseFloat(data.height) || 10,
      status: data.status || 'active',
      pressure: data.pressure || null,
      flowRate: data.flowRate || null,
      pH: data.pH || null,
      temperature: data.temperature || null,
      lastUpdate: data.lastUpdate || Date.now()
    });

    if (!Array.isArray(this.connectedMainValves)) {
      this.connectedMainValves = [];
    }
  }

  calculateCurrentVolume() {
    if (this.shape === 'cylinder') {
      const radius = this.diameter / 2;
      return Math.PI * Math.pow(radius, 2) * this.waterLevel;
    } else if (this.shape === 'cuboid') {
      return this.length * this.breadth * this.waterLevel;
    }
    return (this.waterLevel / this.height) * this.capacity;
  }

  calculateMaxCapacity() {
    if (this.shape === 'cylinder') {
      const radius = this.diameter / 2;
      return Math.PI * Math.pow(radius, 2) * this.height * 1000;
    } else if (this.shape === 'cuboid') {
      return this.length * this.breadth * this.height * 1000;
    }
    return this.capacity;
  }

  calculateWaterLevelFromDistance(distanceMeters) {
    if (distanceMeters === null || distanceMeters === undefined) return this.waterLevel;
    const sensorHeight = this.sensorHeight || this.height;
    const calculatedLevel = Math.max(0, Math.min(sensorHeight, sensorHeight - distanceMeters));
    return calculatedLevel;
  }

  setWaterLevel(level) {
    this.waterLevel = parseFloat(level);
    this.lastUpdate = Date.now();
  }

  update(data) {
    Object.assign(this, data);
  }

  toFirebase() {
    const data = {
      id: this.id,
      name: this.name,
      lat: this.lat,
      lng: this.lng,
      type: this.type,
      capacity: this.capacity,
      waterLevel: this.waterLevel,
      shape: this.shape,
      height: this.height,
      state: this.state,
      district: this.district,
      mandal: this.mandal,
      habitation: this.habitation,
      connectedMainValves: this.connectedMainValves,
      deviceId: this.deviceId,
      sensorHeight: this.sensorHeight,
      status: this.status,
      pressure: this.pressure,
      flowRate: this.flowRate,
      pH: this.pH,
      temperature: this.temperature,
      lastUpdate: this.lastUpdate
    };
    
    // Only include shape-specific dimensions (exclude undefined values)
    if (this.shape === 'cylinder' && this.diameter !== undefined) {
      data.diameter = this.diameter;
    } else if (this.shape === 'cuboid') {
      if (this.length !== undefined) data.length = this.length;
      if (this.breadth !== undefined) data.breadth = this.breadth;
    }
    
    return data;
  }

  info() {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      shape: this.shape,
      capacity: `${this.capacity} L`,
      currentVolume: `${this.calculateCurrentVolume().toFixed(0)} L`,
      waterLevel: `${this.waterLevel} m`,
      pressure: `${this.pressure} PSI`,
      flowRate: `${this.flowRate} L/min`,
      pH: this.pH,
      temperature: `${this.temperature}°C`,
      status: this.status,
      loc: {
        state: this.state,
        district: this.district,
        mandal: this.mandal,
        habitation: this.habitation,
        coords: `${this.lat.toFixed(6)}, ${this.lng.toFixed(6)}`
      }
    };
  }
}

export class Valve {
  constructor(data) {
    Object.assign(this, {
      id: data.id,
      name: data.name || 'Valve',
      lat: parseFloat(data.lat),
      lng: parseFloat(data.lng),
      type: data.type || 'STRAIGHT',
      category: data.category || 'main',
      parentValveId: data.parentValveId || null,
      households: parseInt(data.households) || 0,
      flowRate: parseFloat(data.flowRate) || 50,
      flowDirection: data.flowDirection || 'straight',
      valveState: data.valveState || 'open',
      active: data.active || false,
      status: data.status || 'active',
      mandal: data.mandal || 'Eturunagaram',
      habitation: data.habitation || 'Ellishettypalle',
      battery: data.battery || (Math.random() * 30 + 70).toFixed(0),
      pressure: data.pressure || (Math.random() * 10 + 15).toFixed(1),
      lastUpdate: data.lastUpdate || Date.now()
    });
  }

  generateLiveData() {
    this.battery = (Math.random() * 30 + 70).toFixed(0);
    this.pressure = (Math.random() * 10 + 15).toFixed(1);
    this.lastUpdate = Date.now();
  }

  toggle() {
    this.active = !this.active;
    this.valveState = this.active ? 'closed' : 'open';
  }

  update(data) {
    Object.assign(this, data);
  }

  toFirebase() {
    return {
      id: this.id,
      name: this.name,
      lat: this.lat,
      lng: this.lng,
      type: this.type,
      category: this.category,
      parentValveId: this.parentValveId,
      households: this.households,
      flowRate: this.flowRate,
      flowDirection: this.flowDirection,
      valveState: this.valveState,
      active: this.active,
      status: this.status,
      mandal: this.mandal,
      habitation: this.habitation,
      battery: this.battery,
      pressure: this.pressure,
      lastUpdate: this.lastUpdate
    };
  }

  info() {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      category: this.category,
      households: this.households,
      flowDirection: this.flowDirection,
      valveState: this.valveState,
      battery: `${this.battery}%`,
      pressure: `${this.pressure} PSI`,
      status: this.status,
      loc: {
        mandal: this.mandal,
        habitation: this.habitation,
        coords: `${this.lat.toFixed(6)}, ${this.lng.toFixed(6)}`
      }
    };
  }
}

export class Pipeline {
  constructor(data) {
    Object.assign(this, {
      id: data.id || `pipe_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: data.name || `Pipeline ${Date.now()}`,
      type: data.type || 'PVC',
      diameter: parseFloat(data.diameter) || 150,
      capacity: parseFloat(data.capacity) || 500,
      startPoint: data.startPoint || '',
      endPoint: data.endPoint || '',
      notes: data.notes || '',
      points: data.points || [],
      currentFlow: 0,
      active: data.active !== undefined ? data.active : true
    });
  }

  update(data) {
    Object.assign(this, data);
  }

  toFirebase() {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      diameter: this.diameter,
      capacity: this.capacity,
      startPoint: this.startPoint,
      endPoint: this.endPoint,
      notes: this.notes,
      points: this.points,
      active: this.active
    };
  }
}

