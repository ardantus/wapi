/**
 * Swagger API Paths Documentation
 * This file contains OpenAPI 3.0 path definitions for all WAPI endpoints
 */

const paths = {
    // ===== AUTHENTICATION =====
    '/login': {
        get: {
            tags: ['Authentication'],
            summary: 'Login page',
            description: 'Display the login page',
            responses: { '200': { description: 'Login page HTML' } }
        },
        post: {
            tags: ['Authentication'],
            summary: 'Authenticate user',
            description: 'Login with username and password',
            requestBody: {
                required: true,
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            required: ['username', 'password'],
                            properties: {
                                username: { type: 'string', example: 'admin' },
                                password: { type: 'string', example: 'password' }
                            }
                        }
                    }
                }
            },
            responses: {
                '302': { description: 'Redirect to console on success' },
                '401': { description: 'Invalid credentials' }
            }
        }
    },
    '/logout': {
        post: {
            tags: ['Authentication'],
            summary: 'Logout user',
            description: 'Clear session and logout',
            responses: { '302': { description: 'Redirect to login page' } }
        }
    },

    // ===== CLIENTS =====
    '/clients': {
        get: {
            tags: ['Clients'],
            summary: 'List all clients',
            description: 'Get list of all WhatsApp client instances with status',
            responses: {
                '200': {
                    description: 'List of clients',
                    content: {
                        'application/json': {
                            schema: {
                                type: 'array',
                                items: { $ref: '#/components/schemas/Client' }
                            }
                        }
                    }
                }
            }
        },
        post: {
            tags: ['Clients'],
            summary: 'Create new client',
            description: 'Create a new WhatsApp client instance',
            requestBody: {
                required: true,
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            required: ['id'],
                            properties: {
                                id: { type: 'string', example: 'my-client' }
                            }
                        }
                    }
                }
            },
            responses: {
                '200': { description: 'Client created successfully' },
                '400': { description: 'Invalid client ID or already exists' }
            }
        }
    },
    '/clients/{id}/rotate-key': {
        post: {
            tags: ['Clients'],
            summary: 'Rotate API key',
            description: 'Generate a new API key for the client',
            parameters: [
                { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
            ],
            responses: {
                '200': { description: 'New API key generated' },
                '404': { description: 'Client not found' }
            }
        }
    },
    '/status': {
        get: {
            tags: ['Clients'],
            summary: 'Get client status',
            description: 'Get status of current WhatsApp client',
            security: [{ ApiKeyAuth: [], ClientId: [] }],
            responses: {
                '200': { description: 'Client status information' }
            }
        }
    },
    '/qr': {
        get: {
            tags: ['Clients'],
            summary: 'Get QR code',
            description: 'Get QR code image for WhatsApp authentication',
            parameters: [
                { name: 'client', in: 'query', schema: { type: 'string', default: 'default' } }
            ],
            responses: {
                '200': { description: 'QR code image (PNG)' },
                '204': { description: 'No QR available (already authenticated)' }
            }
        }
    },

    // ===== MESSAGING =====
    '/send': {
        post: {
            tags: ['Messaging'],
            summary: 'Send text message',
            description: 'Send a text message to a WhatsApp number or group',
            security: [{ ApiKeyAuth: [], ClientId: [] }],
            requestBody: {
                required: true,
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            required: ['to', 'message'],
                            properties: {
                                to: { type: 'string', example: '6281234567890@c.us' },
                                message: { type: 'string', example: 'Hello!' },
                                mentions: { type: 'array', items: { type: 'string' }, example: ['6281234567890@c.us'] },
                                quotedMessageId: { type: 'string', description: 'Message ID to reply to' }
                            }
                        }
                    }
                }
            },
            responses: {
                '200': { description: 'Message sent', content: { 'application/json': { schema: { $ref: '#/components/schemas/Success' } } } },
                '400': { description: 'Missing required fields' },
                '500': { description: 'Failed to send message' }
            }
        }
    },
    '/send-media': {
        post: {
            tags: ['Messaging'],
            summary: 'Send media message',
            description: 'Send image, video, audio or document',
            security: [{ ApiKeyAuth: [], ClientId: [] }],
            requestBody: {
                required: true,
                content: {
                    'multipart/form-data': {
                        schema: {
                            type: 'object',
                            required: ['to', 'file'],
                            properties: {
                                to: { type: 'string' },
                                file: { type: 'string', format: 'binary' },
                                caption: { type: 'string' }
                            }
                        }
                    }
                }
            },
            responses: { '200': { description: 'Media sent' } }
        }
    },
    '/send-sticker': {
        post: {
            tags: ['Messaging'],
            summary: 'Send sticker',
            description: 'Send a WebP sticker',
            security: [{ ApiKeyAuth: [], ClientId: [] }],
            requestBody: {
                required: true,
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            required: ['to', 'data'],
                            properties: {
                                to: { type: 'string', example: '6281234567890@c.us' },
                                data: { type: 'string', description: 'Base64 encoded WebP image' }
                            }
                        }
                    }
                }
            },
            responses: { '200': { description: 'Sticker sent' } }
        }
    },
    '/send-location': {
        post: {
            tags: ['Messaging'],
            summary: 'Send location',
            description: 'Send a location message with coordinates',
            security: [{ ApiKeyAuth: [], ClientId: [] }],
            requestBody: {
                required: true,
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            required: ['to', 'latitude', 'longitude'],
                            properties: {
                                to: { type: 'string', example: '6281234567890@c.us' },
                                latitude: { type: 'number', example: -6.2088 },
                                longitude: { type: 'number', example: 106.8456 },
                                address: { type: 'string', example: 'Jakarta, Indonesia' }
                            }
                        }
                    }
                }
            },
            responses: { '200': { description: 'Location sent' } }
        }
    },
    '/send-contact': {
        post: {
            tags: ['Messaging'],
            summary: 'Send contact card',
            description: 'Send a contact vCard',
            security: [{ ApiKeyAuth: [], ClientId: [] }],
            requestBody: {
                required: true,
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            required: ['to', 'contactNumber'],
                            properties: {
                                to: { type: 'string', example: '6281234567890@c.us' },
                                contactNumber: { type: 'string', example: '6289876543210@c.us' },
                                displayName: { type: 'string', example: 'John Doe' }
                            }
                        }
                    }
                }
            },
            responses: { '200': { description: 'Contact sent' } }
        }
    },
    '/send-poll': {
        post: {
            tags: ['Messaging'],
            summary: 'Send poll',
            description: 'Create and send a poll message',
            security: [{ ApiKeyAuth: [], ClientId: [] }],
            requestBody: {
                required: true,
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            required: ['to', 'question', 'options'],
                            properties: {
                                to: { type: 'string', example: '6281234567890@c.us' },
                                question: { type: 'string', example: 'What is your favorite color?' },
                                options: { type: 'array', items: { type: 'string' }, example: ['Red', 'Blue', 'Green'] },
                                allowMultipleAnswers: { type: 'boolean', default: false }
                            }
                        }
                    }
                }
            },
            responses: { '200': { description: 'Poll sent' } }
        }
    },
    '/message/{id}/react': {
        post: {
            tags: ['Messaging'],
            summary: 'React to message',
            description: 'Add emoji reaction to a message',
            security: [{ ApiKeyAuth: [], ClientId: [] }],
            parameters: [
                { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Message ID' }
            ],
            requestBody: {
                required: true,
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            required: ['emoji'],
                            properties: {
                                emoji: { type: 'string', example: '👍' }
                            }
                        }
                    }
                }
            },
            responses: { '200': { description: 'Reaction added' } }
        }
    },

    // ===== CHATS =====
    '/chats': {
        get: {
            tags: ['Chats'],
            summary: 'List all chats',
            description: 'Get list of all chats with names and unread counts',
            security: [{ ApiKeyAuth: [], ClientId: [] }],
            responses: {
                '200': {
                    description: 'List of chats',
                    content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Chat' } } } }
                }
            }
        }
    },
    '/chats/{id}/messages': {
        get: {
            tags: ['Chats'],
            summary: 'Get chat messages',
            description: 'Retrieve messages from a specific chat',
            security: [{ ApiKeyAuth: [], ClientId: [] }],
            parameters: [
                { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
                { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } }
            ],
            responses: {
                '200': { description: 'List of messages', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Message' } } } } }
            }
        }
    },
    '/chat/{id}/mute': {
        post: {
            tags: ['Chats'],
            summary: 'Mute chat',
            description: 'Mute notifications for a chat',
            security: [{ ApiKeyAuth: [], ClientId: [] }],
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            responses: { '200': { description: 'Chat muted' } }
        }
    },
    '/chat/{id}/unmute': {
        post: {
            tags: ['Chats'],
            summary: 'Unmute chat',
            description: 'Unmute notifications for a chat',
            security: [{ ApiKeyAuth: [], ClientId: [] }],
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            responses: { '200': { description: 'Chat unmuted' } }
        }
    },

    // ===== CONTACTS =====
    '/contacts': {
        get: {
            tags: ['Contacts'],
            summary: 'List all contacts',
            description: 'Get list of all contacts',
            security: [{ ApiKeyAuth: [], ClientId: [] }],
            responses: {
                '200': { description: 'List of contacts', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Contact' } } } } }
            }
        }
    },
    '/contact/{id}': {
        get: {
            tags: ['Contacts'],
            summary: 'Get contact details',
            description: 'Get detailed information about a contact',
            security: [{ ApiKeyAuth: [], ClientId: [] }],
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            responses: {
                '200': { description: 'Contact details', content: { 'application/json': { schema: { $ref: '#/components/schemas/Contact' } } } }
            }
        }
    },
    '/contact/{id}/picture': {
        get: {
            tags: ['Contacts'],
            summary: 'Get profile picture',
            description: 'Get profile picture URL of a contact',
            security: [{ ApiKeyAuth: [], ClientId: [] }],
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            responses: { '200': { description: 'Profile picture URL' } }
        }
    },
    '/contact/{id}/block': {
        post: {
            tags: ['Contacts'],
            summary: 'Block contact',
            description: 'Block a contact',
            security: [{ ApiKeyAuth: [], ClientId: [] }],
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            responses: { '200': { description: 'Contact blocked' } }
        }
    },
    '/contact/{id}/unblock': {
        post: {
            tags: ['Contacts'],
            summary: 'Unblock contact',
            description: 'Unblock a previously blocked contact',
            security: [{ ApiKeyAuth: [], ClientId: [] }],
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            responses: { '200': { description: 'Contact unblocked' } }
        }
    },

    // ===== GROUPS =====
    '/group/{id}/participants': {
        get: {
            tags: ['Groups'],
            summary: 'List group participants',
            description: 'Get all participants in a group',
            security: [{ ApiKeyAuth: [], ClientId: [] }],
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            responses: { '200': { description: 'List of participants' } }
        }
    },
    '/group/{id}/invite': {
        get: {
            tags: ['Groups'],
            summary: 'Get invite link',
            description: 'Get the invite link for a group',
            security: [{ ApiKeyAuth: [], ClientId: [] }],
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            responses: { '200': { description: 'Invite link' } }
        }
    },
    '/group/join': {
        post: {
            tags: ['Groups'],
            summary: 'Join group',
            description: 'Join a group using invite link',
            security: [{ ApiKeyAuth: [], ClientId: [] }],
            requestBody: {
                required: true,
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            required: ['invite'],
                            properties: {
                                invite: { type: 'string', example: 'https://chat.whatsapp.com/XXXXXX' }
                            }
                        }
                    }
                }
            },
            responses: { '200': { description: 'Joined group' } }
        }
    },
    '/group/add': {
        post: {
            tags: ['Groups'],
            summary: 'Add participants',
            description: 'Add participants to a group',
            security: [{ ApiKeyAuth: [], ClientId: [] }],
            requestBody: {
                required: true,
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            required: ['groupId', 'participants'],
                            properties: {
                                groupId: { type: 'string' },
                                participants: { type: 'array', items: { type: 'string' } }
                            }
                        }
                    }
                }
            },
            responses: { '200': { description: 'Participants added' } }
        }
    },
    '/group/remove': {
        post: {
            tags: ['Groups'],
            summary: 'Remove participants',
            description: 'Remove participants from a group',
            security: [{ ApiKeyAuth: [], ClientId: [] }],
            requestBody: {
                required: true,
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            required: ['groupId', 'participants'],
                            properties: {
                                groupId: { type: 'string' },
                                participants: { type: 'array', items: { type: 'string' } }
                            }
                        }
                    }
                }
            },
            responses: { '200': { description: 'Participants removed' } }
        }
    },
    '/group/promote': {
        post: {
            tags: ['Groups'],
            summary: 'Promote to admin',
            description: 'Promote participants to group admin',
            security: [{ ApiKeyAuth: [], ClientId: [] }],
            requestBody: {
                required: true,
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            required: ['groupId', 'participants'],
                            properties: {
                                groupId: { type: 'string' },
                                participants: { type: 'array', items: { type: 'string' } }
                            }
                        }
                    }
                }
            },
            responses: { '200': { description: 'Participants promoted' } }
        }
    },
    '/group/demote': {
        post: {
            tags: ['Groups'],
            summary: 'Demote admin',
            description: 'Demote participants from group admin',
            security: [{ ApiKeyAuth: [], ClientId: [] }],
            requestBody: {
                required: true,
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            required: ['groupId', 'participants'],
                            properties: {
                                groupId: { type: 'string' },
                                participants: { type: 'array', items: { type: 'string' } }
                            }
                        }
                    }
                }
            },
            responses: { '200': { description: 'Participants demoted' } }
        }
    },

    // ===== CHANNELS =====
    '/channel/create': {
        post: {
            tags: ['Channels'],
            summary: 'Create channel',
            description: 'Create a new WhatsApp Channel (Newsletter)',
            security: [{ ApiKeyAuth: [], ClientId: [] }],
            requestBody: {
                required: true,
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            required: ['title'],
                            properties: {
                                title: { type: 'string', example: 'My Channel' },
                                description: { type: 'string', example: 'Channel description' }
                            }
                        }
                    }
                }
            },
            responses: { '200': { description: 'Channel created' } }
        }
    },
    '/channel/search': {
        post: {
            tags: ['Channels'],
            summary: 'Search channels',
            description: 'Search for public channels',
            security: [{ ApiKeyAuth: [], ClientId: [] }],
            requestBody: {
                required: true,
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            required: ['query'],
                            properties: {
                                query: { type: 'string', example: 'news' }
                            }
                        }
                    }
                }
            },
            responses: { '200': { description: 'Search results' } }
        }
    },
    '/channel/{id}/subscribe': {
        post: {
            tags: ['Channels'],
            summary: 'Subscribe to channel',
            description: 'Subscribe/follow a channel',
            security: [{ ApiKeyAuth: [], ClientId: [] }],
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            responses: { '200': { description: 'Subscribed to channel' } }
        }
    },
    '/channel/{id}/unsubscribe': {
        post: {
            tags: ['Channels'],
            summary: 'Unsubscribe from channel',
            description: 'Unsubscribe/unfollow a channel',
            security: [{ ApiKeyAuth: [], ClientId: [] }],
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            responses: { '200': { description: 'Unsubscribed from channel' } }
        }
    },

    // ===== MEDIA =====
    '/media/{id}/exists': {
        get: {
            tags: ['Media'],
            summary: 'Check media exists',
            description: 'Check if media file exists',
            security: [{ ApiKeyAuth: [], ClientId: [] }],
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            responses: { '200': { description: 'Media exists status' } }
        }
    },
    '/media/{id}/download': {
        get: {
            tags: ['Media'],
            summary: 'Download media',
            description: 'Download a media file',
            security: [{ ApiKeyAuth: [], ClientId: [] }],
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            responses: { '200': { description: 'Media file' } }
        }
    },

    // ===== SSE =====
    '/events': {
        get: {
            tags: ['Authentication'],
            summary: 'SSE Events stream',
            description: 'Server-Sent Events stream for real-time updates',
            responses: { '200': { description: 'SSE stream' } }
        }
    },

    // ===== ADDITIONAL FEATURES (NEW) =====
    '/chat/{id}/archive': {
        post: {
            tags: ['Chats'],
            summary: 'Archive chat',
            description: 'Archive a chat to hide it from main list',
            security: [{ ApiKeyAuth: [], ClientId: [] }],
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            responses: { '200': { description: 'Chat archived' } }
        }
    },
    '/chat/{id}/unarchive': {
        post: {
            tags: ['Chats'],
            summary: 'Unarchive chat',
            description: 'Unarchive a previously archived chat',
            security: [{ ApiKeyAuth: [], ClientId: [] }],
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            responses: { '200': { description: 'Chat unarchived' } }
        }
    },
    '/chat/{id}/pin': {
        post: {
            tags: ['Chats'],
            summary: 'Pin chat',
            description: 'Pin a chat to the top of the list',
            security: [{ ApiKeyAuth: [], ClientId: [] }],
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            responses: { '200': { description: 'Chat pinned' } }
        }
    },
    '/chat/{id}/unpin': {
        post: {
            tags: ['Chats'],
            summary: 'Unpin chat',
            description: 'Unpin a previously pinned chat',
            security: [{ ApiKeyAuth: [], ClientId: [] }],
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            responses: { '200': { description: 'Chat unpinned' } }
        }
    },
    '/chat/{id}/unread': {
        post: {
            tags: ['Chats'],
            summary: 'Mark as unread',
            description: 'Mark a chat as unread',
            security: [{ ApiKeyAuth: [], ClientId: [] }],
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            responses: { '200': { description: 'Chat marked as unread' } }
        }
    },
    '/chat/{id}/seen': {
        post: {
            tags: ['Chats'],
            summary: 'Send seen',
            description: 'Mark all messages in chat as read (send seen)',
            security: [{ ApiKeyAuth: [], ClientId: [] }],
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            responses: { '200': { description: 'Chat marked as read' } }
        }
    },
    '/group/create': {
        post: {
            tags: ['Groups'],
            summary: 'Create group',
            description: 'Create a new WhatsApp group',
            security: [{ ApiKeyAuth: [], ClientId: [] }],
            requestBody: {
                required: true,
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            required: ['title'],
                            properties: {
                                title: { type: 'string', example: 'My Group' },
                                participants: { type: 'array', items: { type: 'string' }, example: ['6281234567890@c.us'] }
                            }
                        }
                    }
                }
            },
            responses: { '200': { description: 'Group created' } }
        }
    },
    '/group/{id}/requests': {
        get: {
            tags: ['Groups'],
            summary: 'Get membership requests',
            description: 'Get pending membership requests for a group',
            security: [{ ApiKeyAuth: [], ClientId: [] }],
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            responses: { '200': { description: 'List of membership requests' } }
        }
    },
    '/group/{id}/requests/approve': {
        post: {
            tags: ['Groups'],
            summary: 'Approve requests',
            description: 'Approve pending membership requests',
            security: [{ ApiKeyAuth: [], ClientId: [] }],
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            requestBody: {
                content: { 'application/json': { schema: { type: 'object', properties: { requesters: { type: 'array', items: { type: 'string' } } } } } }
            },
            responses: { '200': { description: 'Requests approved' } }
        }
    },
    '/group/{id}/requests/reject': {
        post: {
            tags: ['Groups'],
            summary: 'Reject requests',
            description: 'Reject pending membership requests',
            security: [{ ApiKeyAuth: [], ClientId: [] }],
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            requestBody: {
                content: { 'application/json': { schema: { type: 'object', properties: { requesters: { type: 'array', items: { type: 'string' } } } } } }
            },
            responses: { '200': { description: 'Requests rejected' } }
        }
    },
    '/contacts/blocked': {
        get: {
            tags: ['Contacts'],
            summary: 'Get blocked contacts',
            description: 'Get list of all blocked contacts',
            security: [{ ApiKeyAuth: [], ClientId: [] }],
            responses: { '200': { description: 'List of blocked contacts' } }
        }
    },
    '/profile/picture': {
        put: {
            tags: ['Contacts'],
            summary: 'Set profile picture',
            description: 'Set your profile picture',
            security: [{ ApiKeyAuth: [], ClientId: [] }],
            requestBody: {
                required: true,
                content: { 'application/json': { schema: { type: 'object', required: ['data'], properties: { data: { type: 'string', description: 'Base64 image' }, mimetype: { type: 'string', example: 'image/jpeg' } } } } }
            },
            responses: { '200': { description: 'Profile picture set' } }
        },
        delete: {
            tags: ['Contacts'],
            summary: 'Delete profile picture',
            description: 'Remove your profile picture',
            security: [{ ApiKeyAuth: [], ClientId: [] }],
            responses: { '200': { description: 'Profile picture deleted' } }
        }
    },
    '/messages/search': {
        get: {
            tags: ['Messaging'],
            summary: 'Search messages',
            description: 'Search for messages containing a query',
            security: [{ ApiKeyAuth: [], ClientId: [] }],
            parameters: [
                { name: 'query', in: 'query', required: true, schema: { type: 'string' } },
                { name: 'chatId', in: 'query', schema: { type: 'string' } },
                { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } }
            ],
            responses: { '200': { description: 'Search results' } }
        }
    },
    '/presence/available': {
        post: {
            tags: ['Clients'],
            summary: 'Set presence available',
            description: 'Set your online status to available',
            security: [{ ApiKeyAuth: [], ClientId: [] }],
            responses: { '200': { description: 'Presence set to available' } }
        }
    },
    '/presence/unavailable': {
        post: {
            tags: ['Clients'],
            summary: 'Set presence unavailable',
            description: 'Set your online status to unavailable',
            security: [{ ApiKeyAuth: [], ClientId: [] }],
            responses: { '200': { description: 'Presence set to unavailable' } }
        }
    },
    '/channel/{id}': {
        delete: {
            tags: ['Channels'],
            summary: 'Delete channel',
            description: 'Delete a channel you own',
            security: [{ ApiKeyAuth: [], ClientId: [] }],
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            responses: { '200': { description: 'Channel deleted' } }
        }
    },
    '/labels': {
        get: {
            tags: ['Labels'],
            summary: 'Get labels',
            description: 'Get all labels (WhatsApp Business)',
            security: [{ ApiKeyAuth: [], ClientId: [] }],
            responses: { '200': { description: 'List of labels' } }
        }
    },
    '/labels/{id}/chats': {
        get: {
            tags: ['Labels'],
            summary: 'Get chats by label',
            description: 'Get all chats with a specific label',
            security: [{ ApiKeyAuth: [], ClientId: [] }],
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            responses: { '200': { description: 'List of chats' } }
        }
    },
    '/labels/assign': {
        post: {
            tags: ['Labels'],
            summary: 'Assign labels',
            description: 'Add or remove labels from chats',
            security: [{ ApiKeyAuth: [], ClientId: [] }],
            requestBody: {
                required: true,
                content: { 'application/json': { schema: { type: 'object', required: ['labelIds', 'chatIds'], properties: { labelIds: { type: 'array', items: { type: 'string' } }, chatIds: { type: 'array', items: { type: 'string' } } } } } }
            },
            responses: { '200': { description: 'Labels assigned' } }
        }
    },
    '/call/link': {
        post: {
            tags: ['Messaging'],
            summary: 'Create call link',
            description: 'Generate a WhatsApp call link',
            security: [{ ApiKeyAuth: [], ClientId: [] }],
            requestBody: {
                content: { 'application/json': { schema: { type: 'object', properties: { callType: { type: 'string', enum: ['video', 'voice'], default: 'video' }, startTime: { type: 'string', format: 'date-time' } } } } }
            },
            responses: { '200': { description: 'Call link generated' } }
        }
    },
    '/broadcasts': {
        get: {
            tags: ['Chats'],
            summary: 'Get broadcasts',
            description: 'Get all broadcast lists',
            security: [{ ApiKeyAuth: [], ClientId: [] }],
            responses: { '200': { description: 'List of broadcasts' } }
        }
    }
};

module.exports = paths;

