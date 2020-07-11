import * as MongoClient from 'mongodb';

// The collection within the event database which contains the event details.
const EVENT_DETAILS_COLLECTION = 'details';

// The database used for storing events.
const EVENT_DB = 'events';

export namespace Database {

    export async function connect(uri: string): Promise<EventDetailsConnector> {
        try {
            const client = await MongoClient.connect(uri, {
                useNewUrlParser: true,
                useUnifiedTopology: true,
            });

            return new EventDetailsConnector(client.db(EVENT_DB));
        } catch (e) {
            console.log('failed to connect to the database', e);
            throw e;
        }
    }

    export class EventDetailsConnector {

        constructor(private db: MongoClient.Db) {
        }

        async retrieveQuery(query: {}): Promise<any[]> {
            const collection = this.db.collection(EVENT_DETAILS_COLLECTION);
            return collection.find(query).toArray();
        }

        async insertEvent(content: any): Promise<boolean> {
            const collection = this.db.collection(EVENT_DETAILS_COLLECTION);
            let res = await collection.insertOne(content);

            return (res.result.ok !== undefined)
        }

        async findAndModifyEvent(event_id: number, new_event: any): Promise<boolean> {
            // TODO, setup the database so changes are timestamped in a reversable way. 
            const collection = this.db.collection(EVENT_DETAILS_COLLECTION);

            let res = await collection.replaceOne(
                {
                    _id: new MongoClient.ObjectID(event_id),
                }, 
                new_event
                );
            
            return (res.result.ok !== undefined)
        }

        // Return true if successful.
        async removeEvent(event_id: number): Promise<boolean> {
            // TODO, setup the database so changes are timestamped in a reversable way. 
            const collection = this.db.collection(EVENT_DETAILS_COLLECTION);
            let res: MongoClient.DeleteWriteOpResultObject = await collection.deleteOne(
                {
                    _id: new MongoClient.ObjectID(event_id),
                }
            );
            
            return (res.result.ok !== undefined)
        }
    }

}
