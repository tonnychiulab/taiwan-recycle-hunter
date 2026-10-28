---- MODULE legal_pickup ----
EXTENDS Naturals, FiniteSets

Zones == {
    "sidewalk",
    "arcade",
    "parking_bay",
    "yellow_curb",
    "red_curb",
    "crosswalk",
    "roadway",
    "hydrant",
    "alley_buffer",
    "alley_lane",
    "no_ped"
}

LegalStandingZones == {"sidewalk", "arcade"}
ParkableZones == {"parking_bay", "yellow_curb"}
SignalPhases == {"walk_green", "flashing_green", "stop_red"}

VARIABLES
    runStatus,
    mode,
    zone,
    parkedZone,
    yellowParkTicks,
    yellowOverstayCited,
    signal,
    crosswalkLatch,
    hydrantLatch,
    hydrantDwellTicks,
    alleyStop,
    recyclableCollected,
    contaminantCollected,
    recyclableTalliesCount,
    contaminantTalliesCount,
    claimsCount,
    redLightCitations,
    cartHydrantCitations,
    lastRewardZone

vars == <<
    runStatus,
    mode,
    zone,
    parkedZone,
    yellowParkTicks,
    yellowOverstayCited,
    signal,
    crosswalkLatch,
    hydrantLatch,
    hydrantDwellTicks,
    alleyStop,
    recyclableCollected,
    contaminantCollected,
    recyclableTalliesCount,
    contaminantTalliesCount,
    claimsCount,
    redLightCitations,
    cartHydrantCitations,
    lastRewardZone
>>

TypeOK ==
    /\ runStatus \in {"active", "finished"}
    /\ mode \in {"pushing_cart", "on_foot"}
    /\ zone \in Zones
    /\ parkedZone \in {"none", "parking_bay", "yellow_curb"}
    /\ yellowParkTicks \in 0..4
    /\ yellowOverstayCited \in BOOLEAN
    /\ signal \in SignalPhases
    /\ crosswalkLatch \in {"outside", "legal_green_pass", "illegal_flashing", "illegal_red"}
    /\ hydrantLatch \in {"outside", "on_foot_grace", "on_foot_cited", "cart_cited"}
    /\ hydrantDwellTicks \in 0..4
    /\ alleyStop \in {"unarmed", "pausing", "cleared", "skipped_cited"}
    /\ recyclableCollected \in BOOLEAN
    /\ contaminantCollected \in BOOLEAN
    /\ recyclableTalliesCount \in 0..1
    /\ contaminantTalliesCount \in 0..1
    /\ claimsCount \in 0..1
    /\ redLightCitations \in 0..2
    /\ cartHydrantCitations \in 0..2
    /\ lastRewardZone \in (Zones \cup {"none"})

Init ==
    /\ runStatus = "active"
    /\ mode = "pushing_cart"
    /\ zone = "sidewalk"
    /\ parkedZone = "none"
    /\ yellowParkTicks = 0
    /\ yellowOverstayCited = FALSE
    /\ signal = "walk_green"
    /\ crosswalkLatch = "outside"
    /\ hydrantLatch = "outside"
    /\ hydrantDwellTicks = 0
    /\ alleyStop = "unarmed"
    /\ recyclableCollected = FALSE
    /\ contaminantCollected = FALSE
    /\ recyclableTalliesCount = 0
    /\ contaminantTalliesCount = 0
    /\ claimsCount = 0
    /\ redLightCitations = 0
    /\ cartHydrantCitations = 0
    /\ lastRewardZone = "none"

Cap2(n) == IF n >= 2 THEN 2 ELSE n
Cap4(n) == IF n >= 4 THEN 4 ELSE n

AdvanceSignal ==
    /\ runStatus = "active"
    /\ signal' = CASE signal = "walk_green" -> "flashing_green"
                   [] signal = "flashing_green" -> "stop_red"
                   [] OTHER -> "walk_green"
    /\ UNCHANGED <<
        runStatus, mode, zone, parkedZone, yellowParkTicks, yellowOverstayCited,
        crosswalkLatch, hydrantLatch, hydrantDwellTicks, alleyStop,
        recyclableCollected, contaminantCollected, recyclableTalliesCount,
        contaminantTalliesCount, claimsCount, redLightCitations,
        cartHydrantCitations, lastRewardZone
    >>

MoveAndTick(nextZone, stationary) ==
    /\ runStatus = "active"
    /\ nextZone \in Zones
    /\ zone' = nextZone
    /\ LET enteringCrosswalk == (nextZone = "crosswalk" /\ crosswalkLatch = "outside")
           stayingCrosswalk == (nextZone = "crosswalk" /\ crosswalkLatch # "outside")
           nextCw ==
               IF nextZone # "crosswalk" THEN "outside"
               ELSE IF stayingCrosswalk THEN crosswalkLatch
               ELSE IF signal = "walk_green" THEN "legal_green_pass"
               ELSE IF signal = "flashing_green" THEN "illegal_flashing"
               ELSE "illegal_red"
           cwRedDelta == IF enteringCrosswalk /\ signal = "stop_red" THEN 1 ELSE 0
       IN /\ crosswalkLatch' = nextCw
          /\ redLightCitations' = Cap2(redLightCitations + cwRedDelta)
    /\ LET nextDwell ==
               IF nextZone = "hydrant" /\ mode = "on_foot"
               THEN Cap4(IF zone = "hydrant" THEN hydrantDwellTicks + 1 ELSE 1)
               ELSE 0
           nextHydrantLatch ==
               IF nextZone # "hydrant" THEN "outside"
               ELSE IF mode = "pushing_cart" THEN "cart_cited"
               ELSE IF nextDwell > 3 \/ hydrantLatch = "on_foot_cited" THEN "on_foot_cited"
               ELSE "on_foot_grace"
           hydrantCartDelta ==
               IF nextZone = "hydrant" /\ mode = "pushing_cart" /\ hydrantLatch # "cart_cited"
               THEN 1
               ELSE 0
       IN /\ hydrantDwellTicks' = nextDwell
          /\ hydrantLatch' = nextHydrantLatch
          /\ cartHydrantCitations' = Cap2(cartHydrantCitations + hydrantCartDelta)
    /\ LET nextAlley ==
               IF nextZone = "alley_lane" THEN
                   IF alleyStop = "cleared" THEN "cleared" ELSE "skipped_cited"
               ELSE IF nextZone = "alley_buffer" THEN
                   IF alleyStop = "cleared" \/ stationary THEN "cleared" ELSE "pausing"
               ELSE "unarmed"
       IN alleyStop' = nextAlley
    /\ LET nextYellowTicks ==
               IF mode = "on_foot" /\ parkedZone = "yellow_curb"
               THEN Cap4(yellowParkTicks + 1)
               ELSE yellowParkTicks
           nextYellowCited ==
               IF mode = "on_foot" /\ parkedZone = "yellow_curb" /\ nextYellowTicks > 3
               THEN TRUE
               ELSE yellowOverstayCited
       IN /\ yellowParkTicks' = nextYellowTicks
          /\ yellowOverstayCited' = nextYellowCited
    /\ UNCHANGED <<
        runStatus, mode, parkedZone, signal,
        recyclableCollected, contaminantCollected,
        recyclableTalliesCount, contaminantTalliesCount,
        claimsCount, lastRewardZone
    >>

ParkCart ==
    /\ runStatus = "active"
    /\ mode = "pushing_cart"
    /\ zone \in ParkableZones
    /\ mode' = "on_foot"
    /\ parkedZone' = zone
    /\ yellowParkTicks' = 0
    /\ yellowOverstayCited' = FALSE
    /\ hydrantLatch' = IF zone = "hydrant" THEN "on_foot_grace" ELSE "outside"
    /\ hydrantDwellTicks' = 0
    /\ UNCHANGED <<
        runStatus, zone, signal, crosswalkLatch, alleyStop,
        recyclableCollected, contaminantCollected, recyclableTalliesCount,
        contaminantTalliesCount, claimsCount, redLightCitations,
        cartHydrantCitations, lastRewardZone
    >>

RetrieveCart ==
    /\ runStatus = "active"
    /\ mode = "on_foot"
    /\ zone \in (ParkableZones \cup {"sidewalk", "hydrant"})
    /\ mode' = "pushing_cart"
    /\ parkedZone' = "none"
    /\ yellowParkTicks' = 0
    /\ yellowOverstayCited' = FALSE
    /\ hydrantDwellTicks' = 0
    /\ IF zone = "hydrant"
       THEN /\ hydrantLatch' = "cart_cited"
            /\ cartHydrantCitations' = Cap2(cartHydrantCitations + 1)
       ELSE /\ hydrantLatch' = "outside"
            /\ cartHydrantCitations' = cartHydrantCitations
    /\ UNCHANGED <<
        runStatus, zone, signal, crosswalkLatch, alleyStop,
        recyclableCollected, contaminantCollected, recyclableTalliesCount,
        contaminantTalliesCount, claimsCount, redLightCitations, lastRewardZone
    >>

InteractRecyclable ==
    /\ runStatus = "active"
    /\ ~recyclableCollected
    /\ IF zone \in LegalStandingZones
       THEN /\ recyclableCollected' = TRUE
            /\ recyclableTalliesCount' = recyclableTalliesCount + 1
            /\ claimsCount' = claimsCount + 1
            /\ lastRewardZone' = zone
       ELSE /\ recyclableCollected' = recyclableCollected
            /\ recyclableTalliesCount' = recyclableTalliesCount
            /\ claimsCount' = claimsCount
            /\ lastRewardZone' = lastRewardZone
    /\ UNCHANGED <<
        runStatus, mode, zone, parkedZone, yellowParkTicks, yellowOverstayCited,
        signal, crosswalkLatch, hydrantLatch, hydrantDwellTicks, alleyStop,
        contaminantCollected, contaminantTalliesCount,
        redLightCitations, cartHydrantCitations
    >>

InteractContaminant ==
    /\ runStatus = "active"
    /\ ~contaminantCollected
    /\ contaminantCollected' = TRUE
    /\ contaminantTalliesCount' = contaminantTalliesCount + 1
    /\ UNCHANGED <<
        runStatus, mode, zone, parkedZone, yellowParkTicks, yellowOverstayCited,
        signal, crosswalkLatch, hydrantLatch, hydrantDwellTicks, alleyStop,
        recyclableCollected, recyclableTalliesCount, claimsCount,
        redLightCitations, cartHydrantCitations, lastRewardZone
    >>

FinishRun ==
    /\ runStatus = "active"
    /\ runStatus' = "finished"
    /\ UNCHANGED <<
        mode, zone, parkedZone, yellowParkTicks, yellowOverstayCited,
        signal, crosswalkLatch, hydrantLatch, hydrantDwellTicks, alleyStop,
        recyclableCollected, contaminantCollected, recyclableTalliesCount,
        contaminantTalliesCount, claimsCount, redLightCitations,
        cartHydrantCitations, lastRewardZone
    >>

FinishedIdempotentStep ==
    /\ runStatus = "finished"
    /\ UNCHANGED vars

Next ==
    \/ AdvanceSignal
    \/ \E z \in Zones, s \in BOOLEAN : MoveAndTick(z, s)
    \/ ParkCart
    \/ RetrieveCart
    \/ InteractRecyclable
    \/ InteractContaminant
    \/ FinishRun
    \/ FinishedIdempotentStep

Spec == Init /\ [][Next]_vars

NoIllegalPickupRewarded ==
    /\ claimsCount = recyclableTalliesCount
    /\ (claimsCount > 0 => lastRewardZone \in LegalStandingZones)
    /\ lastRewardZone \notin {"no_ped", "roadway"}

NoCartInHydrantUnpenalized ==
    (mode = "pushing_cart" /\ zone = "hydrant") =>
        (hydrantLatch = "cart_cited" /\ cartHydrantCitations >= 1)

NoRedLightCrosswalkUnpenalized ==
    /\ (zone = "crosswalk" => crosswalkLatch # "outside")
    /\ (crosswalkLatch = "illegal_red" => redLightCitations >= 1)
    /\ (zone = "crosswalk" /\ signal = "stop_red" /\ crosswalkLatch \notin {"legal_green_pass", "illegal_flashing"}) =>
        (crosswalkLatch = "illegal_red" /\ redLightCitations >= 1)

NoTrashCountedAsRecyclable ==
    /\ (contaminantCollected => contaminantTalliesCount = 1)
    /\ (~recyclableCollected => (recyclableTalliesCount = 0 /\ claimsCount = 0))

NoDeadlock ==
    \/ runStatus = "active"
    \/ runStatus = "finished"

====
