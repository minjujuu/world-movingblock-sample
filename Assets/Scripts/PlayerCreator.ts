import { SpawnInfo, ZepetoPlayers } from 'ZEPETO.Character.Controller';
import { ZepetoScriptBehaviour } from 'ZEPETO.Script'
import { WorldService } from 'ZEPETO.World';

export default class PlayerCreator extends ZepetoScriptBehaviour {

    private Start() {
        ZepetoPlayers.instance.CreatePlayerWithUserId("", WorldService.userId, new SpawnInfo(), true);

        ZepetoPlayers.instance.OnAddedLocalPlayer.AddListener(() => {
            ZepetoPlayers.instance.LocalPlayer.zepetoPlayer.character.tag = "Player";
        });
    }
}