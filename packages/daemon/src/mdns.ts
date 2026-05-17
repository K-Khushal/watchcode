import { Bonjour } from "bonjour-service";
import { MDNS_SERVICE_TYPE } from "@watchcode/shared";

export interface MdnsPublisher {
  stop(): void;
}

export function publishMdns(name: string, port: number): MdnsPublisher {
  const bonjour = new Bonjour();
  // Strip "_" prefix and "._tcp" suffix to get the bare type string.
  const type = MDNS_SERVICE_TYPE.replace(/^_/, "").replace(/\._tcp$/, "");
  const service = bonjour.publish({ name, type, port });
  service.start?.();
  return {
    stop() {
      service.stop?.();
      bonjour.destroy();
    },
  };
}
