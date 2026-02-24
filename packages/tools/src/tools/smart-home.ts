import { BaseTool } from '../base.js';
import type { ToolDefinition, ToolResult } from '../base.js';
import { HomeAssistantIntegration } from '../integrations/homeassistant-integration.js';

// Global reference so it can be configured from the Gateway
let haInstance: HomeAssistantIntegration | null = null;

export function setHomeAssistantRef(instance: HomeAssistantIntegration): void {
  haInstance = instance;
}

export function getHomeAssistantRef(): HomeAssistantIntegration | null {
  return haInstance;
}

export class SmartHomeTool extends BaseTool {
  readonly definition: ToolDefinition = {
    name: 'smart_home',
    description: `Control smart home devices via Home Assistant. Actions:
- list_devices: List all devices (optionally filter by domain: light, switch, climate, sensor, cover, media_player, fan, automation, scene)
- get_state: Get current state of a device (entity_id required)
- turn_on: Turn on a device (entity_id required, optional: brightness 0-100 for lights, rgb_color {r,g,b})
- turn_off: Turn off a device (entity_id required)
- toggle: Toggle a device on/off (entity_id required)
- set_temperature: Set thermostat temperature (entity_id + temperature required, optional: hvac_mode)
- set_brightness: Set light brightness 0-100% (entity_id + brightness required)
- set_color: Set light RGB color (entity_id + rgb_color {r,g,b} required)
- activate_scene: Activate a scene (entity_id required, e.g. scene.goodnight)
- call_service: Call any HA service (domain + service required, optional: service_data)
- list_scenes: List all available scenes
- list_automations: List all automations`,
    category: 'automation',
    parameters: [
      { name: 'action', type: 'string', description: 'Action to perform: list_devices, get_state, turn_on, turn_off, toggle, set_temperature, set_brightness, set_color, activate_scene, call_service, list_scenes, list_automations', required: true },
      { name: 'entity_id', type: 'string', description: 'Home Assistant entity ID (e.g. light.living_room, switch.fan, climate.bedroom)', required: false },
      { name: 'domain', type: 'string', description: 'Device domain filter for list_devices (light, switch, sensor, climate, cover, media_player, fan, automation, scene)', required: false },
      { name: 'brightness', type: 'number', description: 'Light brightness percentage (0-100)', required: false },
      { name: 'rgb_color', type: 'object', description: 'RGB color object: { r: 0-255, g: 0-255, b: 0-255 }', required: false },
      { name: 'temperature', type: 'number', description: 'Target temperature for climate devices', required: false },
      { name: 'hvac_mode', type: 'string', description: 'HVAC mode: heat, cool, auto, off, fan_only, dry', required: false },
      { name: 'service', type: 'string', description: 'Service name for call_service (e.g. turn_on, turn_off, toggle)', required: false },
      { name: 'service_data', type: 'object', description: 'Additional service data for call_service', required: false },
    ],
  };

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const validationError = this.validateParams(params);
    if (validationError) return { success: false, error: validationError, duration: 0 };

    if (!haInstance || !haInstance.isConfigured()) {
      return {
        success: false,
        error: 'Home Assistant is not configured. Please set up Home Assistant URL and token in Dashboard Settings.',
        duration: 0,
      };
    }

    const action = String(params['action']);
    const entityId = params['entity_id'] as string | undefined;

    const { result, duration } = await this.timed(async () => {
      switch (action) {
        case 'list_devices': {
          const domain = params['domain'] as string | undefined;
          const entities = await haInstance!.listDevicesByDomain(domain);
          const summary = entities.map(e => ({
            entity_id: e.entity_id,
            name: e.friendly_name || e.entity_id,
            state: e.state,
            ...(e.attributes.brightness !== undefined ? { brightness: Math.round((e.attributes.brightness as number) / 2.55) + '%' } : {}),
            ...(e.attributes.temperature !== undefined ? { temperature: e.attributes.temperature } : {}),
            ...(e.attributes.current_temperature !== undefined ? { current_temperature: e.attributes.current_temperature } : {}),
          }));
          return { devices: summary, count: summary.length, domain: domain || 'all' };
        }

        case 'get_state': {
          if (!entityId) throw new Error('entity_id is required for get_state');
          const entity = await haInstance!.getState(entityId);
          return {
            entity_id: entity.entity_id,
            name: entity.friendly_name || entity.entity_id,
            state: entity.state,
            attributes: entity.attributes,
            last_changed: entity.last_changed,
          };
        }

        case 'turn_on': {
          if (!entityId) throw new Error('entity_id is required for turn_on');
          const serviceData: Record<string, unknown> = {};
          if (params['brightness'] !== undefined) {
            serviceData.brightness = Math.max(0, Math.min(255, Math.round(Number(params['brightness']) * 2.55)));
          }
          if (params['rgb_color']) {
            const c = params['rgb_color'] as { r: number; g: number; b: number };
            serviceData.rgb_color = [c.r, c.g, c.b];
          }
          const result = await haInstance!.turnOn(entityId, serviceData);
          return { action: 'turn_on', entity_id: entityId, result: result.length > 0 ? 'success' : 'executed', new_state: result[0]?.state };
        }

        case 'turn_off': {
          if (!entityId) throw new Error('entity_id is required for turn_off');
          const result = await haInstance!.turnOff(entityId);
          return { action: 'turn_off', entity_id: entityId, result: result.length > 0 ? 'success' : 'executed', new_state: result[0]?.state };
        }

        case 'toggle': {
          if (!entityId) throw new Error('entity_id is required for toggle');
          const result = await haInstance!.toggle(entityId);
          return { action: 'toggle', entity_id: entityId, result: result.length > 0 ? 'success' : 'executed', new_state: result[0]?.state };
        }

        case 'set_brightness': {
          if (!entityId) throw new Error('entity_id is required for set_brightness');
          const brightness = Number(params['brightness']);
          if (isNaN(brightness) || brightness < 0 || brightness > 100) {
            throw new Error('brightness must be a number between 0 and 100');
          }
          await haInstance!.setLightBrightness(entityId, brightness);
          return { action: 'set_brightness', entity_id: entityId, brightness: brightness + '%', result: 'success' };
        }

        case 'set_color': {
          if (!entityId) throw new Error('entity_id is required for set_color');
          const rgb = params['rgb_color'] as { r: number; g: number; b: number } | undefined;
          if (!rgb || rgb.r === undefined || rgb.g === undefined || rgb.b === undefined) {
            throw new Error('rgb_color object with r, g, b (0-255) is required');
          }
          await haInstance!.setLightColor(entityId, rgb);
          return { action: 'set_color', entity_id: entityId, color: rgb, result: 'success' };
        }

        case 'set_temperature': {
          if (!entityId) throw new Error('entity_id is required for set_temperature');
          const temp = Number(params['temperature']);
          if (isNaN(temp)) throw new Error('temperature must be a number');
          const hvacMode = params['hvac_mode'] as string | undefined;
          await haInstance!.setClimate(entityId, temp, hvacMode);
          return { action: 'set_temperature', entity_id: entityId, temperature: temp, hvac_mode: hvacMode || 'unchanged', result: 'success' };
        }

        case 'activate_scene': {
          if (!entityId) throw new Error('entity_id is required for activate_scene');
          const sceneId = entityId.startsWith('scene.') ? entityId : `scene.${entityId}`;
          await haInstance!.activateScene(sceneId);
          return { action: 'activate_scene', scene: sceneId, result: 'success' };
        }

        case 'call_service': {
          const domain = params['domain'] as string | undefined;
          const service = params['service'] as string | undefined;
          if (!domain || !service) throw new Error('domain and service are required for call_service');
          const serviceData = (params['service_data'] || {}) as Record<string, unknown>;
          if (entityId) serviceData.entity_id = entityId;
          const result = await haInstance!.callService(domain, service, serviceData);
          return { action: 'call_service', domain, service, entities_affected: result.length, result: 'success' };
        }

        case 'list_scenes': {
          const scenes = await haInstance!.listScenes();
          return { scenes, count: scenes.length };
        }

        case 'list_automations': {
          const automations = await haInstance!.listAutomations();
          const summary = automations.map(a => ({
            entity_id: a.entity_id,
            name: a.friendly_name || a.entity_id,
            state: a.state,
          }));
          return { automations: summary, count: summary.length };
        }

        default:
          throw new Error(`Unknown action: ${action}. Valid actions: list_devices, get_state, turn_on, turn_off, toggle, set_temperature, set_brightness, set_color, activate_scene, call_service, list_scenes, list_automations`);
      }
    });

    return { success: true, data: result, duration };
  }
}
