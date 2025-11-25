// CML (Compressed Markup Language) Utilities for VIBE IDE
// Parser and renderer for CML files

/**
 * Parse a CML file string into a structured object
 */
function parseCML(cmlString) {
    try {
        // Extract header: [timestamp|type|participants|location|tags]{
        const headerMatch = cmlString.match(/^\[([^\]]+)\]\{/);
        if (!headerMatch) {
            throw new Error('Invalid CML format: missing header');
        }
        
        const headerParts = headerMatch[1].split('|');
        const header = {
            timestamp: headerParts[0] || null,
            type: headerParts[1] || null,
            participants: headerParts[2] ? headerParts[2].split(',') : [],
            location: headerParts[3] || null,
            tags: headerParts[4] ? headerParts[4].split(',').map(t => t.trim()) : []
        };
        
        // Extract body (everything between { and })
        const bodyMatch = cmlString.match(/\{([\s\S]*)\}$/);
        if (!bodyMatch) {
            throw new Error('Invalid CML format: missing body');
        }
        
        // Parse body as structured data (simplified - assumes valid format)
        // This is a basic parser - could be enhanced for full CML spec
        const body = parseCMLBody(bodyMatch[1]);
        
        return {
            header,
            body,
            raw: cmlString
        };
    } catch (error) {
        console.error('Error parsing CML:', error);
        return null;
    }
}

/**
 * Parse CML body content (simplified parser)
 * Handles basic key-value pairs, arrays, and nested objects
 */
function parseCMLBody(bodyString) {
    const result = {};
    let currentKey = null;
    let currentValue = '';
    let depth = 0;
    let inString = false;
    let stringChar = null;
    let i = 0;
    
    while (i < bodyString.length) {
        const char = bodyString[i];
        const nextChar = bodyString[i + 1];
        
        if (!inString) {
            if (char === '"' || char === "'") {
                inString = true;
                stringChar = char;
                currentValue += char;
            } else if (char === '{') {
                depth++;
                currentValue += char;
            } else if (char === '}') {
                depth--;
                currentValue += char;
            } else if (char === '[') {
                depth++;
                currentValue += char;
            } else if (char === ']') {
                depth--;
                currentValue += char;
            } else if (char === ';' && depth === 0) {
                // End of statement
                if (currentKey && currentValue.trim()) {
                    result[currentKey.trim()] = parseCMLValue(currentValue.trim());
                }
                currentKey = null;
                currentValue = '';
            } else if (char === ':' && depth === 0 && !currentKey) {
                // Key-value separator
                currentKey = currentValue.trim();
                currentValue = '';
            } else {
                currentValue += char;
            }
        } else {
            currentValue += char;
            if (char === stringChar && bodyString[i - 1] !== '\\') {
                inString = false;
                stringChar = null;
            }
        }
        
        i++;
    }
    
    // Handle last value
    if (currentKey && currentValue.trim()) {
        result[currentKey.trim()] = parseCMLValue(currentValue.trim());
    }
    
    return result;
}

/**
 * Parse a CML value (string, number, array, object, boolean)
 */
function parseCMLValue(value) {
    value = value.trim();
    
    // String
    if ((value.startsWith('"') && value.endsWith('"')) || 
        (value.startsWith("'") && value.endsWith("'"))) {
        return value.slice(1, -1);
    }
    
    // Array
    if (value.startsWith('[') && value.endsWith(']')) {
        const content = value.slice(1, -1).trim();
        if (!content) return [];
        
        // Simple array parsing (comma-separated)
        const items = [];
        let current = '';
        let depth = 0;
        let inString = false;
        let stringChar = null;
        
        for (let i = 0; i < content.length; i++) {
            const char = content[i];
            
            if (!inString) {
                if (char === '"' || char === "'") {
                    inString = true;
                    stringChar = char;
                    current += char;
                } else if (char === '{' || char === '[') {
                    depth++;
                    current += char;
                } else if (char === '}' || char === ']') {
                    depth--;
                    current += char;
                } else if (char === ',' && depth === 0) {
                    items.push(parseCMLValue(current.trim()));
                    current = '';
                } else {
                    current += char;
                }
            } else {
                current += char;
                if (char === stringChar && content[i - 1] !== '\\') {
                    inString = false;
                    stringChar = null;
                }
            }
        }
        
        if (current.trim()) {
            items.push(parseCMLValue(current.trim()));
        }
        
        return items;
    }
    
    // Object
    if (value.startsWith('{') && value.endsWith('}')) {
        return parseCMLBody(value.slice(1, -1));
    }
    
    // Number
    if (/^-?\d+(\.\d+)?$/.test(value)) {
        return parseFloat(value);
    }
    
    // Boolean
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (value === 'null') return null;
    
    // Default: return as string
    return value;
}

/**
 * Render CML data into a narrative story (markdown)
 */
function renderCMLToStory(cmlData) {
    if (!cmlData || !cmlData.header) {
        return '# Invalid CML Data\n\nUnable to render story from CML data.';
    }
    
    const { header, body } = cmlData;
    let story = '';
    
    // Title
    if (body.title) {
        story += `# ${body.title}\n\n`;
    } else {
        const typeName = header.type ? header.type.charAt(0).toUpperCase() + header.type.slice(1) : 'Event';
        const date = header.timestamp ? new Date(header.timestamp).toLocaleDateString() : 'Unknown Date';
        story += `# ${typeName}: ${date}\n\n`;
    }
    
    // Context/Description
    if (body.context || body.description) {
        story += `${body.context || body.description}\n\n`;
    }
    
    // Participants
    if (header.participants && header.participants.length > 0) {
        story += `**Participants:** ${header.participants.join(', ')}\n\n`;
    }
    
    // Location
    if (header.location || body.location) {
        story += `**Location:** ${header.location || body.location}\n\n`;
    }
    
    // Timeline
    if (body.timeline && Array.isArray(body.timeline)) {
        story += `## Timeline\n\n`;
        body.timeline.forEach((event, index) => {
            const time = event.time ? new Date(event.time).toLocaleTimeString() : '';
            story += `### ${time || `Event ${index + 1}`}\n\n`;
            if (event.event) story += `**${event.event}**\n\n`;
            if (event.description) story += `${event.description}\n\n`;
            if (event.damo) story += `*"${event.damo}"* - Damo\n\n`;
        });
    }
    
    // Recipe-specific rendering
    if (header.type === 'recipe' && body.recipe) {
        const recipe = body.recipe;
        story += `## Recipe: ${recipe.name || 'Untitled Recipe'}\n\n`;
        
        if (recipe.meal) story += `**Meal:** ${recipe.meal}\n\n`;
        if (recipe.serves) story += `**Serves:** ${recipe.serves}\n\n`;
        if (recipe.prepTime) story += `**Prep Time:** ${recipe.prepTime}\n\n`;
        if (recipe.cookTime) story += `**Cook Time:** ${recipe.cookTime}\n\n`;
        
        if (recipe.ingredients && Array.isArray(recipe.ingredients)) {
            story += `### Ingredients\n\n`;
            recipe.ingredients.forEach(ing => {
                story += `- ${ing}\n`;
            });
            story += `\n`;
        }
        
        if (recipe.instructions && Array.isArray(recipe.instructions)) {
            story += `### Instructions\n\n`;
            recipe.instructions.forEach((inst, idx) => {
                story += `${idx + 1}. ${inst}\n`;
            });
            story += `\n`;
        }
        
        if (recipe.notes) {
            story += `### Notes\n\n${recipe.notes}\n\n`;
        }
        
        if (recipe.variations && Array.isArray(recipe.variations)) {
            story += `### Variations\n\n`;
            recipe.variations.forEach(var => {
                story += `- ${var}\n`;
            });
            story += `\n`;
        }
        
        if (recipe.rating) {
            story += `**Rating:** ${recipe.rating}\n\n`;
        }
    }
    
    // Impact/Significance
    if (body.impact || body.significance) {
        story += `## Impact\n\n${body.impact || body.significance}\n\n`;
    }
    
    // Quotes
    if (body.quotes && Array.isArray(body.quotes)) {
        story += `## Quotes\n\n`;
        body.quotes.forEach(quote => {
            story += `> "${quote}"\n\n`;
        });
    }
    
    // Tags
    if (header.tags && header.tags.length > 0) {
        story += `**Tags:** ${header.tags.map(t => `#${t}`).join(' ')}\n\n`;
    }
    
    return story;
}

/**
 * Create a new CML file from structured data
 */
function createCML(header, body) {
    const timestamp = header.timestamp || new Date().toISOString();
    const type = header.type || 'event';
    const participants = header.participants ? header.participants.join(',') : '';
    const location = header.location || '';
    const tags = header.tags ? header.tags.join(',') : '';
    
    let cml = `[${timestamp}|${type}|${participants}|${location}|${tags}]{\n`;
    cml += stringifyCMLBody(body, 1);
    cml += `}\n`;
    
    return cml;
}

/**
 * Convert body object to CML string format
 */
function stringifyCMLBody(body, indent = 0) {
    const indentStr = '  '.repeat(indent);
    let result = '';
    
    for (const [key, value] of Object.entries(body)) {
        result += indentStr + key + ':';
        
        if (Array.isArray(value)) {
            result += '[\n';
            value.forEach((item, idx) => {
                if (typeof item === 'object' && item !== null) {
                    result += indentStr + '  {\n';
                    result += stringifyCMLBody(item, indent + 2);
                    result += indentStr + '  }';
                } else {
                    result += indentStr + '  "' + String(item).replace(/"/g, '\\"') + '"';
                }
                if (idx < value.length - 1) result += ',';
                result += '\n';
            });
            result += indentStr + ']';
        } else if (typeof value === 'object' && value !== null) {
            result += ' {\n';
            result += stringifyCMLBody(value, indent + 1);
            result += indentStr + '}';
        } else if (typeof value === 'string') {
            result += ' "' + value.replace(/"/g, '\\"') + '"';
        } else {
            result += ' ' + String(value);
        }
        
        result += ';\n';
    }
    
    return result;
}

// Export functions
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        parseCML,
        renderCMLToStory,
        createCML,
        stringifyCMLBody
    };
} else {
    window.CMLUtils = {
        parseCML,
        renderCMLToStory,
        createCML,
        stringifyCMLBody
    };
}

