/**
 * Temperature state management for agent-xpto extension
 * 
 * Stores the current agent's temperature setting to be applied
 * via the before_provider_request event handler.
 */

let currentTemperature: number | undefined = undefined;

/**
 * Set the current agent's temperature value
 */
export function setAgentTemperature(temp?: number): void {
	currentTemperature = temp;
}

/**
 * Get the current agent's temperature value
 * Returns undefined when no temperature is configured
 */
export function getAgentTemperature(): number | undefined {
	return currentTemperature;
}