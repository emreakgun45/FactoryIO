// opcua-server.js
// Simülatörü TIA Portal'ın göreceği bir OPC UA Server'a dönüştürür
// TIA Portal bu sunucuya bağlanır, tag'leri okur/yazar

const {
  OPCUAServer,
  Variant,
  DataType,
  StatusCodes,
  nodesets,
} = require("node-opcua");

class FactoryIOOpcUaServer {
  constructor(port = 4840) {
    this.port = port;
    this.server = null;
    this.tags = {
      Sensor_S1:  false,
      Sensor_S2:  false,
      Sensor_S3:  false,
      Motor_M1:   false,
      Piston_A1:  false,
      Fault_Lamp: false,
    };
    this.nodes = {};
    this.onTagWrite = null; // Callback: TIA Portal bir tag yazdığında
  }

  async start() {
    this.server = new OPCUAServer({
      port: this.port,
      resourcePath: "/UA/FactoryIOSim",
      buildInfo: {
        productName: "FactoryIO Simülatör",
        buildNumber: "1.0.0",
        buildDate: new Date(),
      },
      serverInfo: {
        applicationName: { text: "FactoryIO PLC Simülatör" },
        applicationUri: "urn:FactoryIOSim:PLC",
      },
    });

    await this.server.initialize();
    this._buildAddressSpace();
    await this.server.start();

    const endpoint = this.server.endpoints[0].endpointDescriptions()[0];
    console.log(`[OPC UA] Server başlatıldı: ${endpoint.endpointUrl}`);
    console.log(`[OPC UA] TIA Portal bu adrese bağlanabilir: opc.tcp://localhost:${this.port}`);
    return endpoint.endpointUrl;
  }

  async stop() {
    if (this.server) await this.server.shutdown();
  }

  _buildAddressSpace() {
    const addressSpace = this.server.engine.addressSpace;
    const namespace = addressSpace.getOwnNamespace();

    // FactoryIO PLC klasörü oluştur
    const plcFolder = namespace.addFolder("RootFolder", {
      browseName: "FactoryIO_PLC",
      displayName: "FactoryIO PLC Simülatör",
    });

    // Tag'leri ekle
    Object.keys(this.tags).forEach((tagName) => {
      const isInput = tagName.startsWith("Sensor");
      
      const node = namespace.addVariable({
        componentOf: plcFolder,
        browseName: tagName,
        displayName: tagName,
        dataType: DataType.Boolean,
        value: {
          get: () => new Variant({
            dataType: DataType.Boolean,
            value: this.tags[tagName],
          }),
          set: (variant) => {
            const oldVal = this.tags[tagName];
            this.tags[tagName] = variant.value;
            if (oldVal !== variant.value) {
              console.log(`[OPC UA] TIA Portal yazdı: ${tagName} = ${variant.value}`);
              if (this.onTagWrite) this.onTagWrite(tagName, variant.value);
            }
            return StatusCodes.Good;
          },
        },
      });

      this.nodes[tagName] = node;
    });

    console.log(`[OPC UA] ${Object.keys(this.tags).length} tag tanımlandı`);
  }

  // Simülatörden tag güncelle (sensör tetiklenince)
  updateTag(tagName, value) {
    if (this.tags[tagName] === undefined) return;
    const oldVal = this.tags[tagName];
    this.tags[tagName] = value;
    if (oldVal !== value) {
      // OPC UA subscription'larına bildir
      const node = this.nodes[tagName];
      if (node) node.setValueFromSource(new Variant({
        dataType: DataType.Boolean,
        value: value,
      }));
      console.log(`[OPC UA] Tag güncellendi: ${tagName} = ${value}`);
    }
  }

  getTag(tagName) {
    return this.tags[tagName] ?? false;
  }

  getAllTags() {
    return { ...this.tags };
  }
}

module.exports = { FactoryIOOpcUaServer };

// Standalone çalıştırma (test için)
if (require.main === module) {
  const server = new FactoryIOOpcUaServer(4840);
  server.onTagWrite = (tag, val) => {
    console.log(`TIA Portal → ${tag} = ${val}`);
  };

  server.start().then(() => {
    console.log("\n=== FactoryIO OPC UA Server Çalışıyor ===");
    console.log("TIA Portal'da External OPC UA Server olarak ekle:");
    console.log("  URL: opc.tcp://localhost:4840");
    console.log("  Namespace: FactoryIO_PLC");
    console.log("\nTest için 3 saniyede bir Sensor_S1 toggle ediliyor...\n");

    // Test: Sensor_S1'i toggle et
    let val = false;
    setInterval(() => {
      val = !val;
      server.updateTag("Sensor_S1", val);
      server.updateTag("Sensor_S2", !val);
    }, 3000);
  }).catch(console.error);

  process.on("SIGINT", async () => {
    await server.stop();
    process.exit(0);
  });
}
