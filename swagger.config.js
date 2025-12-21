const swaggerJsdoc = require('swagger-jsdoc');

const options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'WhatsApp Web.js API',
            version: '1.0.0',
            description: 'REST API for WhatsApp Web automation using whatsapp-web.js library. Send messages, manage chats, handle media, and control WhatsApp groups programmatically.',
            contact: {
                name: 'API Support',
                url: 'https://github.com/pedroslopez/whatsapp-web.js'
            },
            license: {
                name: 'Apache 2.0',
                url: 'https://www.apache.org/licenses/LICENSE-2.0.html'
            }
        },
        servers: [
            {
                url: 'http://localhost:3000',
                description: 'Development server'
            },
            {
                url: 'http://localhost:3000',
                description: 'Production server (update as needed)'
            }
        ],
        tags: [
            { name: 'Authentication', description: 'Login and session management' },
            { name: 'Clients', description: 'WhatsApp client instance management' },
            { name: 'Messaging', description: 'Send messages, media, stickers, and polls' },
            { name: 'Chats', description: 'Chat and message history' },
            { name: 'Contacts', description: 'Contact management and profile data' },
            { name: 'Groups', description: 'Group management and participant control' },
            { name: 'Channels', description: 'WhatsApp Channels (Newsletter) features' },
            { name: 'Media', description: 'Media file downloads and management' }
        ],
        components: {
            securitySchemes: {
                ApiKeyAuth: {
                    type: 'apiKey',
                    in: 'query',
                    name: 'api_key',
                    description: 'API key for authentication. Obtain from `/clients` endpoint or rotate with `/clients/:id/rotate-key`'
                },
                ClientId: {
                    type: 'apiKey',
                    in: 'query',
                    name: 'client',
                    description: 'Client ID to specify which WhatsApp instance to use. Default is "default"'
                }
            },
            schemas: {
                Client: {
                    type: 'object',
                    properties: {
                        id: { type: 'string', example: 'default' },
                        status: { type: 'string', example: 'authenticated' },
                        apiKey: { type: 'string', example: 'ak_1234567890abcdef' },
                        uptime: { type: 'string', example: '2h 15m 30s' },
                        messagesSaved: { type: 'integer', example: 142 },
                        memoryUsage: { type: 'string', example: '245 MB' }
                    }
                },
                Chat: {
                    type: 'object',
                    properties: {
                        id: { type: 'string', example: '6281234567890@c.us' },
                        name: { type: 'string', example: 'John Doe' },
                        isGroup: { type: 'boolean', example: false }
                    }
                },
                Contact: {
                    type: 'object',
                    properties: {
                        id: { type: 'string', example: '6281234567890@c.us' },
                        name: { type: 'string', example: 'John Doe' },
                        pushname: { type: 'string', example: 'Johnny' },
                        number: { type: 'string', example: '6281234567890' },
                        isMyContact: { type: 'boolean', example: true },
                        isBlocked: { type: 'boolean', example: false },
                        isBusiness: { type: 'boolean', example: false },
                        isEnterprise: { type: 'boolean', example: false }
                    }
                },
                Message: {
                    type: 'object',
                    properties: {
                        id: { type: 'string', example: 'true_6281234567890@c.us_3EB0123456789ABCDEF' },
                        from: { type: 'string', example: '6281234567890@c.us' },
                        body: { type: 'string', example: 'Hello, world!' },
                        timestamp: { type: 'integer', example: 1640000000 },
                        hasMedia: { type: 'boolean', example: false },
                        mediaType: { type: 'string', example: 'image', nullable: true },
                        mediaPath: { type: 'string', example: 'default/msg123.jpg', nullable: true }
                    }
                },
                Error: {
                    type: 'object',
                    properties: {
                        error: { type: 'string', example: 'Error message describing what went wrong' }
                    }
                },
                Success: {
                    type: 'object',
                    properties: {
                        success: { type: 'boolean', example: true },
                        id: { type: 'string', example: 'true_6281234567890@c.us_3EB0123456789ABCDEF' }
                    }
                }
            }
        },
        security: [
            {
                ApiKeyAuth: [],
                ClientId: []
            }
        ]
    },
    apis: ['./server.js'] // Path to the API docs
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;
