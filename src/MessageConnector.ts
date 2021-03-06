import { Channel, connect as amqpConnect, Connection, Message, } from 'amqplib';

import { CommentMessageValidator, SignupMessageValidator, CommentResponse, EventMessageValidator, EventResponse, MessageValidator, SignupResponse } from '@uems/uemscommlib';
import { tryApplyTrait } from "@uems/micro-builder/build/src";

const fs = require('fs').promises;

// Represents the RabbitMQ config file in memory.
type MqConfig = {
    uri: String
};

// The queue of requests being received by this microservice.
const RCV_INBOX_QUEUE_NAME: string = 'dionysus_inbox';

// The exchange used for sending messages back to the gateway(s).
const GATEWAY_EXCHANGE: string = 'gateway';

// The exchange used for receiving requests to microservices.
const REQUEST_EXCHANGE: string = 'request';

// The timeout (milliseconds) used before retrying a connection to rabbitMQ.
const RABBIT_MQ_RETRY_TIMEOUT: number = 2000;

export namespace Messaging {

    import EventResponseMessage = EventResponse.EventResponseMessage;
    import CommentResponseMessage = CommentResponse.CommentResponseMessage;
    import SignupResponseMessage = SignupResponse.SignupResponseMessage;

    export type MessageResponses = EventResponseMessage | CommentResponseMessage | SignupResponseMessage;
    type MessageHandler = (
        routingKey: string,
        message: any,
    ) => (MessageResponses | null) | Promise<MessageResponses | null>;

    export class Messenger {
        // Connection to the RabbitMQ messaging system.
        conn: Connection;

        // Channel for sending responses to requests.
        send_ch: Channel;

        // Channel for receiving requests.
        rcv_ch: Channel;

        // Checks incoming message is valid with respect to event msg schema.
        msgValidators: MessageValidator[];

        // The function called when a request is received (after checking for valid schema).
        msg_callback: MessageHandler;

        private constructor(
            conn: Connection,
            sendCh: Channel,
            rcvCh: Channel,
            msgValidators: MessageValidator[],
            msgCallback: MessageHandler,
        ) {
            this.conn = conn;
            this.send_ch = sendCh;
            this.rcv_ch = rcvCh;
            this.msgValidators = msgValidators;
            this.msg_callback = msgCallback;
        }

        // Called when a message/request is received.
        async handleMsg(msg: Message | null) {
            if (msg == null) {
                return;
            }

            let contentJson: any;
            try {
                contentJson = JSON.parse(msg.content.toString());
            } catch (e) {
                console.error('Did not receive a valid JSON message on the queue, rejecting');
                return;
            }

            const passesValidation = (await Promise.all(
                // Run the message against all validators and then reduce the result
                this.msgValidators.map((validator) => validator.validate(contentJson)),
            )).reduce((a, b) => a || b);

            if (!passesValidation) {
                // Messages not compliant with the schema are dropped.
                console.log('Message Dropped: Not Schema Compliant');
                console.log('Invalid message', contentJson);
                return;
            }

            const res: MessageResponses | null = await this.msg_callback(msg.fields.routingKey, contentJson);

            if (res == null) {
                // A null response indicates no response.
                return;
            }

            await Messaging.Messenger.sendResponse(res, this.send_ch);
        }

        // Once a request has been handled and the response returned this method takes that request message and the
        // response message content to generate and send the response message.
        static async sendResponse(res: MessageResponses, sendCh: Channel) {
            sendCh.publish(GATEWAY_EXCHANGE, '', Buffer.from(JSON.stringify(res)));
        }

        // Configure the connection ready for usage by the microservice.
        // Retuns a setup Messager.
        // The given callback is assigned as the callback for receiving a request to this service.
        // If the callback resolves to null then no response is sent.
        static async configureConnection(
            conn: Connection,
            msgCallback: MessageHandler,
            topics: string[],
            msgValidators: MessageValidator[],
        ) {
            conn.on('error', (err: Error) => {
                if (err.message !== 'Connection closing') {
                    console.error('[AMQP] conn error', err.message);
                    tryApplyTrait('rabbitmq', false);
                }
            });
            conn.on('close', () => {
                console.error('[AMQP] connection closed');
                tryApplyTrait('rabbitmq', false);
            });
            console.log('[AMQP] connected');

            const sendCh = await conn.createChannel();
            await sendCh.assertExchange(GATEWAY_EXCHANGE, 'direct');
            const rcvCh = await conn.createChannel();
            await rcvCh.assertExchange(REQUEST_EXCHANGE, 'topic', {
                durable: false,
            });
            const queue = await rcvCh.assertQueue(RCV_INBOX_QUEUE_NAME, {
                // Exclusive false as there may be multiple instances of this microservice sharing the queue
                exclusive: false,
            });

            topics.forEach((topic) => {
                console.log(`MessageConnector: binding ${topic} to this queue`);
                rcvCh.bindQueue(queue.queue, REQUEST_EXCHANGE, topic);
            });

            const messenger = new Messaging.Messenger(conn, sendCh, rcvCh, msgValidators, msgCallback);

            await rcvCh.consume(queue.queue, async (msg) => {
                await messenger.handleMsg(msg);
            }, { noAck: true });

            return messenger;
        }

        // Creates a new Messager to be used by the microservice for communication including receiving requests and
        // sending responses. Uses the config at the given path to configure the connection to rabbitMQ. The given
        // req_recv_callback is called if a message is received with the argument being the message content as an
        // object. Connect function is given as a parameter to enable testing
        static async setup(
            configPath: string,
            reqRecvCallback: MessageHandler,
            topics: string[],
            connectionFunction: (url: string) => Promise<Connection> = amqpConnect,
        ) {
            const msgValidator: MessageValidator[] = [
                new EventMessageValidator(),
                new CommentMessageValidator(),
                new SignupMessageValidator(),
            ];
            console.log('Connecting to rabbitmq...');
            const data = await fs.readFile(configPath);
            const configJson: MqConfig = JSON.parse(data.toString());
            // Loops to allow retrying multiple times without having to reload the config.
            // eslint-disable-next-line no-constant-condition
            while (true) {
                try {
                    // no-await-in-loop: used to retry an action, ignored as per
                    // https://eslint.org/docs/rules/no-await-in-loop
                    // eslint-disable-next-line no-await-in-loop
                    const res = await connectionFunction(`${configJson.uri}?heartbeat=60`)
                        .then(
                            (conn: Connection) => {
                                // Debugging implementation
                                if (conn === undefined) {
                                    return;
                                }

                                Messenger.configureConnection(conn, reqRecvCallback, topics, msgValidator)
                                    .then(
                                        (messenger: Messenger) => messenger,
                                    );
                            },
                        );
                    return res;
                } catch (e) {
                    console.error('Failed to connect to rabbit mq', e);
                    tryApplyTrait('rabbitmq', false);

                    // This forces a timeout before retrying connection.
                    // eslint-disable-next-line no-await-in-loop
                    await new Promise((resolve) => setTimeout(resolve, RABBIT_MQ_RETRY_TIMEOUT));
                    console.log('Attempting to reconnect to RabbitMQ....');
                }
            }
        }
    }
}
