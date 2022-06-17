import { Collider } from 'UnityEngine';
import { ZepetoScriptBehaviour } from 'ZEPETO.Script'
import BlockMultiplay from './BlockMultiplay';

export default class CarrierParentController extends ZepetoScriptBehaviour {

    private sessionId: string = "";

    public SetSessionId(sessionId: string) {
        this.sessionId = sessionId;
    }

    private OnTriggerEnter(coll: Collider) {
        if (coll.tag == "Platform") {
            BlockMultiplay.GetInstance().MoveBlockToPlatform(this.sessionId);
        }
    }

}