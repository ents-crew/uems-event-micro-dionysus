import { DataHandlerInterface } from './DataHandlerInterface';
import { EntStateMessage, EntStateResponse } from '@uems/uemscommlib';
import { EntState, EntStateDatabaseInterface, EntStateQuery } from '../type/impl/EntStateDatabaseInterface';
import { MsgIntention, MsgStatus } from '@uems/uemscommlib/build/messaging/types/event_response_schema';
import ReadEntStateMessage = EntStateMessage.ReadEntStateMessage;
import CreateEntStateMessage = EntStateMessage.CreateEntStateMessage;
import UpdateEntStateMessage = EntStateMessage.UpdateEntStateMessage;
import DeleteEntStateMessage = EntStateMessage.DeleteEntStateMessage;
import EntStateResponseMessage = EntStateResponse.EntStateResponseMessage;
import EntStateReadResponseMessage = EntStateResponse.EntStateReadResponseMessage;
import { ObjectID } from "mongodb";

export class EntStateInterface implements DataHandlerInterface<ReadEntStateMessage,
    CreateEntStateMessage,
    UpdateEntStateMessage,
    DeleteEntStateMessage,
    EntStateResponseMessage,
    EntStateReadResponseMessage> {

    protected _db: EntStateDatabaseInterface;

    constructor(db: EntStateDatabaseInterface) {
        this._db = db;
    }

    private static convertReadRequestToDatabaseQuery(request: ReadEntStateMessage): EntStateQuery {
        const obj: any = {
            color: request.color,
            icon: request.icon,
            name: request.name,
        };

        if (request.id) {
            obj._id = new ObjectID(request.id);
        }

        return Object.fromEntries(Object.entries(obj)
            .filter(([, value]) => value !== undefined));
    }

    async create(request: EntStateMessage.CreateEntStateMessage): Promise<EntStateResponseMessage> {
        try {
            const result = await this._db.insert({
                id: '0', // Placeholder
                color: request.color,
                icon: request.icon,
                name: request.name,
            });

            if (result.id) {
                return {
                    msg_id: request.msg_id,
                    msg_intention: MsgIntention.CREATE,
                    result: [result.id],
                    status: MsgStatus.SUCCESS,
                };
            }

            return {
                msg_id: request.msg_id,
                msg_intention: MsgIntention.CREATE,
                result: [result.err_msg === undefined ? '' : result.err_msg],
                status: MsgStatus.FAIL,
            };
        } catch (e) {
            return {
                msg_id: request.msg_id,
                msg_intention: MsgIntention.CREATE,
                result: ['Failed to create the ent state in the backing store'],
                status: MsgStatus.FAIL,
            };
        }
    }

    async delete(request: EntStateMessage.DeleteEntStateMessage): Promise<EntStateResponseMessage> {
        if (request.id === undefined) {
            return {
                msg_id: request.msg_id,
                msg_intention: MsgIntention.DELETE,
                result: ['Invalid request, id was not specified'],
                status: MsgStatus.FAIL,
            };
        }

        const result = await this._db.remove(request.id);

        return {
            msg_id: request.msg_id,
            msg_intention: MsgIntention.DELETE,
            result: [request.id],
            status: (result ? MsgStatus.SUCCESS : MsgStatus.FAIL),
        };
    }

    async modify(request: EntStateMessage.UpdateEntStateMessage): Promise<EntStateResponseMessage> {
        if (request.id === undefined) {
            return {
                msg_id: request.msg_id,
                msg_intention: MsgIntention.UPDATE,
                result: ['Invalid request, \'id\' was not specified'],
                status: MsgStatus.FAIL,
            };
        }

        const updated: Partial<EntState> = {};

        if (request.name) updated.name = request.name;
        if (request.icon) updated.icon = request.icon;
        if (request.color) updated.color = request.color;

        const result = await this._db.modify(request.id, updated);

        return {
            msg_id: request.msg_id,
            msg_intention: MsgIntention.UPDATE,
            result: [request.id],
            status: (result ? MsgStatus.SUCCESS : MsgStatus.FAIL),
        };
    }

    async read(request: EntStateMessage.ReadEntStateMessage): Promise<EntStateReadResponseMessage> {
        const query = EntStateInterface.convertReadRequestToDatabaseQuery(request);
        console.log('executing query', query);
        const data: EntState[] = await this._db.retrieve(query);
        console.log('got', data);

        return {
            msg_id: request.msg_id,
            msg_intention: MsgIntention.READ,
            result: data,
            status: MsgStatus.SUCCESS,
        };
    }

}