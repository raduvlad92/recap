// New additive61/62 logical deltas from isolated PG17. Native60 pins remain the retained accepted values.
// No credential, private account/source row or native baseline is stored here.
export const providerAdmissionContract=Object.freeze({
  "schema": 1,
  "servingCommit": "9bb3f1430115666d45d71212ab294bb3e1555de5",
  "acceptedPredecessorObjectsSha256": "9efe6f97614a1929bf41fae0c978b5ceeeea20f4e3de700d538f31f28824d563",
  "acceptedPredecessorHistorySha256": "46c592f17514dc11ab750cdbff7274064f6a64ac00262040f46dc2c027754bcf",
  "prerequisiteVersions": [
    "20261021013525",
    "20261021014030",
    "20261021021732",
    "20261021023748",
    "20261021025224",
    "20261021104211",
    "20261021104534",
    "20261021105224",
    "20261021105734",
    "20261021111453",
    "20261021111858",
    "20261022220119",
    "20261022221123",
    "20261022221400",
    "20261022235056",
    "20261022235532",
    "20261023000813",
    "20261024001046",
    "20261024001118",
    "20261024194042",
    "20261024195307",
    "20261024202950",
    "20261025001519",
    "20261025184542",
    "20261025195400",
    "20261025220548",
    "20261026223029",
    "20261027000338",
    "20261027020041",
    "20261027030132",
    "20261027100851",
    "20261027165035",
    "20261027234400",
    "20261028023000",
    "20261028024500",
    "20261028130000",
    "20261028233915",
    "20261029015509",
    "20261029022238",
    "20261029123923",
    "20261031002750",
    "20261031002813",
    "20261031002826",
    "20261031003121",
    "20261031005641",
    "20261031013730",
    "20261104090000",
    "20261104095658",
    "20261104110432",
    "20261104115513",
    "20261105011050",
    "20261107194452",
    "20261107200416",
    "20261107203128",
    "20261107204220",
    "20261107205636",
    "20261107224727",
    "20261111023125",
    "20261111023748",
    "20261111211058"
  ],
  "sources": [
    {
      "file": "20261112041617_model_provider_diagnostics.sql",
      "version": "20261112041617",
      "name": "model_provider_diagnostics",
      "sourceSha256": "58ad06669e4a4485f1fc4f33fc242dc243ff605d6882c57b17197e4aff173909",
      "bodySha256": "4c58a08c27aef44f1ab7820e0e1811d2df86fd54a3deea2b2ea3486938e30cea"
    },
    {
      "file": "20261112041618_metadata_provider_admission.sql",
      "version": "20261112041618",
      "name": "metadata_provider_admission",
      "sourceSha256": "4cf5e1da6f826a6e2428bc3d7adfc2f270a461cb101cd1ef1461e6efe0abbeb4",
      "bodySha256": "f4bf50bffbfdac698dcf5ef04ffcf06a38b3f4828b8a2c7b5384ae5052c7f36b"
    }
  ],
  "newTables": [
    "public.collection_metadata_contracts",
    "public.collection_metadata_intents",
    "public.collection_metadata_observations",
    "public.collection_metadata_scopes",
    "recap_internal.model_provider_diagnostics"
  ],
  "changes": [
    {
      "key": "column:public.collection_metadata_contracts.body",
      "beforeSha256": null,
      "afterSha256": "b47944105f90b44090334b5ba49b6954eb6baf246df51de40780695730988a3b",
      "allowIdentityChange": false
    },
    {
      "key": "column:public.collection_metadata_contracts.canonical_body",
      "beforeSha256": null,
      "afterSha256": "4cb0f757c9520dd1dc81f359d35451a43a762eba11a7c4a3316e1605425f2f54",
      "allowIdentityChange": false
    },
    {
      "key": "column:public.collection_metadata_contracts.created_at",
      "beforeSha256": null,
      "afterSha256": "48f8eb85e1dab0369cc1c892842cd1578c720569d998c81f74831bcff7853469",
      "allowIdentityChange": false
    },
    {
      "key": "column:public.collection_metadata_contracts.digest",
      "beforeSha256": null,
      "afterSha256": "ba61d603b49250788b553efc68bb4c81fc7ea3ce8a086bd80565ea941be79909",
      "allowIdentityChange": false
    },
    {
      "key": "column:public.collection_metadata_contracts_pkey.digest",
      "beforeSha256": null,
      "afterSha256": "993b04ff78b1e9baddaea49811cd13e8565804c22c31da122a788f9b7f59948e",
      "allowIdentityChange": false
    },
    {
      "key": "column:public.collection_metadata_intents.attempt_ordinal",
      "beforeSha256": null,
      "afterSha256": "f1d551af7620127949007ecd26489f61d273e66fb6deb00c70fff06a5e58294a",
      "allowIdentityChange": false
    },
    {
      "key": "column:public.collection_metadata_intents.authority",
      "beforeSha256": null,
      "afterSha256": "0c2f6db37c5d9e0a340da519feb930a73762a4743139521256e04421a5e39bed",
      "allowIdentityChange": false
    },
    {
      "key": "column:public.collection_metadata_intents.check_id",
      "beforeSha256": null,
      "afterSha256": "1c73fed1717fa1759c6648a68c378da61c7c038fa370f4573592c6e8788c6539",
      "allowIdentityChange": false
    },
    {
      "key": "column:public.collection_metadata_intents.contract_digest",
      "beforeSha256": null,
      "afterSha256": "6f94bd7ef9eaf2c9ad57db29a93068271720ee17bed0f24ad50aa2b4cace2cf1",
      "allowIdentityChange": false
    },
    {
      "key": "column:public.collection_metadata_intents.created_at",
      "beforeSha256": null,
      "afterSha256": "a8190db20289f58f6ffd866948824328a3f2572de9e86af638d08544f0ad4c61",
      "allowIdentityChange": false
    },
    {
      "key": "column:public.collection_metadata_intents.id",
      "beforeSha256": null,
      "afterSha256": "9abda785c9e450fad710e15b0a89e3c3a58ea42254a7d2bb755459be3b1b3b17",
      "allowIdentityChange": false
    },
    {
      "key": "column:public.collection_metadata_intents.job_id",
      "beforeSha256": null,
      "afterSha256": "0d7947d1224c906ee260928a47e60d312fb702550f9c9955eb14b0848628b015",
      "allowIdentityChange": false
    },
    {
      "key": "column:public.collection_metadata_intents.prepared_digest",
      "beforeSha256": null,
      "afterSha256": "1b08e66c529955b83157cfdbdb9c28ccecb635d40416680b09f8d62775ac0f56",
      "allowIdentityChange": false
    },
    {
      "key": "column:public.collection_metadata_intents.reservation_id",
      "beforeSha256": null,
      "afterSha256": "28fd10ba5aab13280db6d5eb2ba5cac9676a84b069d7ee4eb3723317a477978f",
      "allowIdentityChange": false
    },
    {
      "key": "column:public.collection_metadata_intents.scope_id",
      "beforeSha256": null,
      "afterSha256": "3fc1c4f2bee88198e088c401a1fa72e5b6a1cc4dd6fc349e45b1ef2b6d7b2a62",
      "allowIdentityChange": false
    },
    {
      "key": "column:public.collection_metadata_intents_job_id_key.job_id",
      "beforeSha256": null,
      "afterSha256": "19322027ef469f00d1714d6a4ec5c78331f5d7588bbd343e6310a972f3ff113c",
      "allowIdentityChange": false
    },
    {
      "key": "column:public.collection_metadata_intents_pkey.id",
      "beforeSha256": null,
      "afterSha256": "19322027ef469f00d1714d6a4ec5c78331f5d7588bbd343e6310a972f3ff113c",
      "allowIdentityChange": false
    },
    {
      "key": "column:public.collection_metadata_intents_reservation_id_key.reservation_id",
      "beforeSha256": null,
      "afterSha256": "19322027ef469f00d1714d6a4ec5c78331f5d7588bbd343e6310a972f3ff113c",
      "allowIdentityChange": false
    },
    {
      "key": "column:public.collection_metadata_intents_scope_id_key.scope_id",
      "beforeSha256": null,
      "afterSha256": "19322027ef469f00d1714d6a4ec5c78331f5d7588bbd343e6310a972f3ff113c",
      "allowIdentityChange": false
    },
    {
      "key": "column:public.collection_metadata_observations.body",
      "beforeSha256": null,
      "afterSha256": "47a65ccb2d51621da2f74faf65c825d4c28e6d15e9979317a15d6d2ef2b938e6",
      "allowIdentityChange": false
    },
    {
      "key": "column:public.collection_metadata_observations.contract_digest",
      "beforeSha256": null,
      "afterSha256": "6f94bd7ef9eaf2c9ad57db29a93068271720ee17bed0f24ad50aa2b4cace2cf1",
      "allowIdentityChange": false
    },
    {
      "key": "column:public.collection_metadata_observations.created_at",
      "beforeSha256": null,
      "afterSha256": "5e0de8c8ab3ef535c977e6dbccc7abd19009cddb0d99f9b75c564264effb8c39",
      "allowIdentityChange": false
    },
    {
      "key": "column:public.collection_metadata_observations.id",
      "beforeSha256": null,
      "afterSha256": "40d31daab3db098be5cc7c577889e87f648fb8d05d241703196a65ebf853ed8e",
      "allowIdentityChange": false
    },
    {
      "key": "column:public.collection_metadata_observations.intent_id",
      "beforeSha256": null,
      "afterSha256": "97039669738e499e64555c9ae05870e105734fea13af533b7185ca304413b433",
      "allowIdentityChange": false
    },
    {
      "key": "column:public.collection_metadata_observations.kind",
      "beforeSha256": null,
      "afterSha256": "3a1472992eb168dbe1185cd8aac43cf7a6f70aff08d0bf8cfaa704dd1237d742",
      "allowIdentityChange": false
    },
    {
      "key": "column:public.collection_metadata_observations.observation_key",
      "beforeSha256": null,
      "afterSha256": "89f89799adbd243c9dd4cc1cf8208360a0a0e8cb30da092719e9c185bca24499",
      "allowIdentityChange": false
    },
    {
      "key": "column:public.collection_metadata_observations_observation_key_key.observation_key",
      "beforeSha256": null,
      "afterSha256": "993b04ff78b1e9baddaea49811cd13e8565804c22c31da122a788f9b7f59948e",
      "allowIdentityChange": false
    },
    {
      "key": "column:public.collection_metadata_observations_pkey.id",
      "beforeSha256": null,
      "afterSha256": "19322027ef469f00d1714d6a4ec5c78331f5d7588bbd343e6310a972f3ff113c",
      "allowIdentityChange": false
    },
    {
      "key": "column:public.collection_metadata_scopes.archive_id",
      "beforeSha256": null,
      "afterSha256": "7ef69251412037e8d4d1d327d42a8aa552298188527500fca41eb48c94d3ae5b",
      "allowIdentityChange": false
    },
    {
      "key": "column:public.collection_metadata_scopes.archive_revision",
      "beforeSha256": null,
      "afterSha256": "5715c146ab4d555ebf71ebfcf6aaf9dd97e5a1b1197ed81cc4ed1264465cd838",
      "allowIdentityChange": false
    },
    {
      "key": "column:public.collection_metadata_scopes.channel_id",
      "beforeSha256": null,
      "afterSha256": "cafa6450241f06a14cd9c9153c662c4b5f7811c5dba4a55e426c27233eb3d6a2",
      "allowIdentityChange": false
    },
    {
      "key": "column:public.collection_metadata_scopes.check_id",
      "beforeSha256": null,
      "afterSha256": "0277880f33a3dd48a6e4cf87fdfdfaf7a9a1c1402e4b383db9dac92a7b884b6a",
      "allowIdentityChange": false
    },
    {
      "key": "column:public.collection_metadata_scopes.contract_digest",
      "beforeSha256": null,
      "afterSha256": "a1056ac7c9f35ef038cb8c4ee776c33ccc30f514fe242f8abcf2c1294130f749",
      "allowIdentityChange": false
    },
    {
      "key": "column:public.collection_metadata_scopes.created_at",
      "beforeSha256": null,
      "afterSha256": "d2cdef9cd7c652327ff4d5a27cedc982e9b9b772a9d7448c2c94145ad2da0b41",
      "allowIdentityChange": false
    },
    {
      "key": "column:public.collection_metadata_scopes.expected_control",
      "beforeSha256": null,
      "afterSha256": "266e3daef0f361f7c5b7b295df92e9f8e417e3c1f12e7b2b0fc2aa4f4c25924a",
      "allowIdentityChange": false
    },
    {
      "key": "column:public.collection_metadata_scopes.expires_at",
      "beforeSha256": null,
      "afterSha256": "7b4c0233b508c2512f6e3ce014f60036a091d44614f939aecb40f8edf9b1ca54",
      "allowIdentityChange": false
    },
    {
      "key": "column:public.collection_metadata_scopes.fallback_of",
      "beforeSha256": null,
      "afterSha256": "8969df2f66e94e9f4d0781ed96edafd03ab2671f2ae694075f84e317bda3b60f",
      "allowIdentityChange": false
    },
    {
      "key": "column:public.collection_metadata_scopes.id",
      "beforeSha256": null,
      "afterSha256": "40d31daab3db098be5cc7c577889e87f648fb8d05d241703196a65ebf853ed8e",
      "allowIdentityChange": false
    },
    {
      "key": "column:public.collection_metadata_scopes.input_canonical",
      "beforeSha256": null,
      "afterSha256": "e3ecd75343e9e80a7834228ee37025f17a3c80dbbc3d145b2664380e5cbd6b12",
      "allowIdentityChange": false
    },
    {
      "key": "column:public.collection_metadata_scopes.maximum_calls",
      "beforeSha256": null,
      "afterSha256": "4959d1e4aa8a54b07c9874a94d489ad2147f3143db64e52d1bfd8d498186298d",
      "allowIdentityChange": false
    },
    {
      "key": "column:public.collection_metadata_scopes.maximum_usd",
      "beforeSha256": null,
      "afterSha256": "de2880ef95ecb7fda6b278173409986d97351d3390671287addb9c9e04aeb924",
      "allowIdentityChange": false
    },
    {
      "key": "column:public.collection_metadata_scopes.parent_id",
      "beforeSha256": null,
      "afterSha256": "16a9d3e182d41f1d2e344ceec6aa54fd4e3a82ef6bbd0bb5cdd5c396911ac810",
      "allowIdentityChange": false
    },
    {
      "key": "column:public.collection_metadata_scopes.purpose",
      "beforeSha256": null,
      "afterSha256": "4cb0f757c9520dd1dc81f359d35451a43a762eba11a7c4a3316e1605425f2f54",
      "allowIdentityChange": false
    },
    {
      "key": "column:public.collection_metadata_scopes.qualification_control",
      "beforeSha256": null,
      "afterSha256": "9b8f766b6e1b485e522ebb72196a71ee0d55e626f375d23792222360ea403c91",
      "allowIdentityChange": false
    },
    {
      "key": "column:public.collection_metadata_scopes.request_canonical",
      "beforeSha256": null,
      "afterSha256": "f14628bc0db4b64b7c4beb9da192358c6b4340c0b86c40c3e6e3b281ee401e98",
      "allowIdentityChange": false
    },
    {
      "key": "column:public.collection_metadata_scopes.request_sha256",
      "beforeSha256": null,
      "afterSha256": "488950530e414534fa8633df068eac5d3f3f85a808d76b21d4e548ab28079fcf",
      "allowIdentityChange": false
    },
    {
      "key": "column:public.collection_metadata_scopes.source_fingerprint",
      "beforeSha256": null,
      "afterSha256": "1aeef121ee363d410a5865486872c8b7a09cd396282371f693a23401e625dc40",
      "allowIdentityChange": false
    },
    {
      "key": "column:public.collection_metadata_scopes.source_hash",
      "beforeSha256": null,
      "afterSha256": "33e85cb5e271742712dbdbb7aab10f7554a86d6062e5b872ad4b51a9627cfc0f",
      "allowIdentityChange": false
    },
    {
      "key": "column:public.collection_metadata_scopes.source_id",
      "beforeSha256": null,
      "afterSha256": "c8fb6a99787c3fb8e32b32036f41abe9851cace276e5c1db96b27b2629de06a2",
      "allowIdentityChange": false
    },
    {
      "key": "column:public.collection_metadata_scopes.target_url",
      "beforeSha256": null,
      "afterSha256": "9ea4ee6e373dd25fce23a2531debc26daf71ae28b255898894eb9072db6a08cd",
      "allowIdentityChange": false
    },
    {
      "key": "column:public.collection_metadata_scopes.user_id",
      "beforeSha256": null,
      "afterSha256": "6f94bd7ef9eaf2c9ad57db29a93068271720ee17bed0f24ad50aa2b4cace2cf1",
      "allowIdentityChange": false
    },
    {
      "key": "column:public.collection_metadata_scopes.video_id",
      "beforeSha256": null,
      "afterSha256": "871e3e3ed2744f018b9acb8b75850642ecbd7c9ac5dcd06e4384bc509d0d55da",
      "allowIdentityChange": false
    },
    {
      "key": "column:public.collection_metadata_scopes.workspace_revision",
      "beforeSha256": null,
      "afterSha256": "30070528aa949901f954ef3f281aab49366fdf286bba63469c042816105e0c35",
      "allowIdentityChange": false
    },
    {
      "key": "column:public.collection_metadata_scopes_pkey.id",
      "beforeSha256": null,
      "afterSha256": "19322027ef469f00d1714d6a4ec5c78331f5d7588bbd343e6310a972f3ff113c",
      "allowIdentityChange": false
    },
    {
      "key": "column:public.metadata_intents_contract.contract_digest",
      "beforeSha256": null,
      "afterSha256": "993b04ff78b1e9baddaea49811cd13e8565804c22c31da122a788f9b7f59948e",
      "allowIdentityChange": false
    },
    {
      "key": "column:public.metadata_intents_contract.created_at",
      "beforeSha256": null,
      "afterSha256": "32459c1b1863d77a7471472d7eed2435802e5f1853f93cca168ef7ca0bf2fa31",
      "allowIdentityChange": false
    },
    {
      "key": "column:public.metadata_observations_intent.created_at",
      "beforeSha256": null,
      "afterSha256": "32459c1b1863d77a7471472d7eed2435802e5f1853f93cca168ef7ca0bf2fa31",
      "allowIdentityChange": false
    },
    {
      "key": "column:public.metadata_observations_intent.id",
      "beforeSha256": null,
      "afterSha256": "60194f64989b817d0f9c6ed829c1e1547e1d8147456822b7c8e48ef401745bc2",
      "allowIdentityChange": false
    },
    {
      "key": "column:public.metadata_observations_intent.intent_id",
      "beforeSha256": null,
      "afterSha256": "19322027ef469f00d1714d6a4ec5c78331f5d7588bbd343e6310a972f3ff113c",
      "allowIdentityChange": false
    },
    {
      "key": "column:public.metadata_observations_qualification.contract_digest",
      "beforeSha256": null,
      "afterSha256": "993b04ff78b1e9baddaea49811cd13e8565804c22c31da122a788f9b7f59948e",
      "allowIdentityChange": false
    },
    {
      "key": "column:public.metadata_observations_qualification.created_at",
      "beforeSha256": null,
      "afterSha256": "32459c1b1863d77a7471472d7eed2435802e5f1853f93cca168ef7ca0bf2fa31",
      "allowIdentityChange": false
    },
    {
      "key": "column:public.metadata_observations_qualification.id",
      "beforeSha256": null,
      "afterSha256": "60194f64989b817d0f9c6ed829c1e1547e1d8147456822b7c8e48ef401745bc2",
      "allowIdentityChange": false
    },
    {
      "key": "column:recap_internal.model_provider_diagnostics.attempt_number",
      "beforeSha256": null,
      "afterSha256": "2b6a8f3fff4024dcc2d22e3b18f23db6d5343b65976e9eba048f70e1192fe6b4",
      "allowIdentityChange": false
    },
    {
      "key": "column:recap_internal.model_provider_diagnostics.call_id",
      "beforeSha256": null,
      "afterSha256": "9abda785c9e450fad710e15b0a89e3c3a58ea42254a7d2bb755459be3b1b3b17",
      "allowIdentityChange": false
    },
    {
      "key": "column:recap_internal.model_provider_diagnostics.created_at",
      "beforeSha256": null,
      "afterSha256": "5e0de8c8ab3ef535c977e6dbccc7abd19009cddb0d99f9b75c564264effb8c39",
      "allowIdentityChange": false
    },
    {
      "key": "column:recap_internal.model_provider_diagnostics.diagnostic",
      "beforeSha256": null,
      "afterSha256": "47a65ccb2d51621da2f74faf65c825d4c28e6d15e9979317a15d6d2ef2b938e6",
      "allowIdentityChange": false
    },
    {
      "key": "column:recap_internal.model_provider_diagnostics.error_code",
      "beforeSha256": null,
      "afterSha256": "3a1472992eb168dbe1185cd8aac43cf7a6f70aff08d0bf8cfaa704dd1237d742",
      "allowIdentityChange": false
    },
    {
      "key": "column:recap_internal.model_provider_diagnostics.request_hash",
      "beforeSha256": null,
      "afterSha256": "89f89799adbd243c9dd4cc1cf8208360a0a0e8cb30da092719e9c185bca24499",
      "allowIdentityChange": false
    },
    {
      "key": "column:recap_internal.model_provider_diagnostics.session_id",
      "beforeSha256": null,
      "afterSha256": "65cf05a37366e511719bfeaa14d161f7456b769259d6b4ba3b246dcb0e4e9540",
      "allowIdentityChange": false
    },
    {
      "key": "column:recap_internal.model_provider_diagnostics_pkey.attempt_number",
      "beforeSha256": null,
      "afterSha256": "ba46cb1fb9b383ade66b81408e4affa51e6eb1d88323fc4ae0982803d71a6554",
      "allowIdentityChange": false
    },
    {
      "key": "column:recap_internal.model_provider_diagnostics_pkey.call_id",
      "beforeSha256": null,
      "afterSha256": "19322027ef469f00d1714d6a4ec5c78331f5d7588bbd343e6310a972f3ff113c",
      "allowIdentityChange": false
    },
    {
      "key": "column:recap_internal.model_provider_diagnostics_session_idx.call_id",
      "beforeSha256": null,
      "afterSha256": "97039669738e499e64555c9ae05870e105734fea13af533b7185ca304413b433",
      "allowIdentityChange": false
    },
    {
      "key": "column:recap_internal.model_provider_diagnostics_session_idx.session_id",
      "beforeSha256": null,
      "afterSha256": "19322027ef469f00d1714d6a4ec5c78331f5d7588bbd343e6310a972f3ff113c",
      "allowIdentityChange": false
    },
    {
      "key": "constraint:public.collection_metadata_contracts.collection_metadata_contracts_body_check",
      "beforeSha256": null,
      "afterSha256": "3977a30440ae029dda9e94de34dbcdb805034415f2fb2e6b920172095c7c1247",
      "allowIdentityChange": false
    },
    {
      "key": "constraint:public.collection_metadata_contracts.collection_metadata_contracts_body_check1",
      "beforeSha256": null,
      "afterSha256": "f89095023099dc48df3c28f77365ef9d310f6d9553ca9dd0a03014f57edbc0f7",
      "allowIdentityChange": false
    },
    {
      "key": "constraint:public.collection_metadata_contracts.collection_metadata_contracts_canonical_body_check",
      "beforeSha256": null,
      "afterSha256": "27dac4509db966e75786c39d7d0cf14157a99504300b7766c9ecb2bc53905388",
      "allowIdentityChange": false
    },
    {
      "key": "constraint:public.collection_metadata_contracts.collection_metadata_contracts_check",
      "beforeSha256": null,
      "afterSha256": "3889dd7bedd0f37cc39fd189892ccc09c0c92e6678ac34d075020b8ac4be8fc1",
      "allowIdentityChange": false
    },
    {
      "key": "constraint:public.collection_metadata_contracts.collection_metadata_contracts_digest_check",
      "beforeSha256": null,
      "afterSha256": "43d9d9d25c0e79ff312e0dc475ff66d6bbaa49f7f10807bd6a329d159253b7f0",
      "allowIdentityChange": false
    },
    {
      "key": "constraint:public.collection_metadata_contracts.collection_metadata_contracts_pkey",
      "beforeSha256": null,
      "afterSha256": "602ae2d6942231b494f94f206180132d63295837d8cabfdc746cb975cf4f0e3e",
      "allowIdentityChange": false
    },
    {
      "key": "constraint:public.collection_metadata_contracts.metadata_contract_strings",
      "beforeSha256": null,
      "afterSha256": "6491eee78b9d41aab0f9d1d139ac1e74819592e06a86eb11a5f4c02db19f4585",
      "allowIdentityChange": false
    },
    {
      "key": "constraint:public.collection_metadata_intents.collection_metadata_intents_attempt_ordinal_check",
      "beforeSha256": null,
      "afterSha256": "be2e563a30de7cb886e1f32f1f7d6f6205f1541fe1a4b620b69b314289bbeb5b",
      "allowIdentityChange": false
    },
    {
      "key": "constraint:public.collection_metadata_intents.collection_metadata_intents_authority_check",
      "beforeSha256": null,
      "afterSha256": "1aa5daa637eb37ba8e65888cfd67c4731402ddf65047cfe64c21142ca19c4005",
      "allowIdentityChange": false
    },
    {
      "key": "constraint:public.collection_metadata_intents.collection_metadata_intents_check_id_fkey",
      "beforeSha256": null,
      "afterSha256": "b2a8de154282c078aca5ef3adcf015275eaf786b7562e40788619e28dfca00b7",
      "allowIdentityChange": false
    },
    {
      "key": "constraint:public.collection_metadata_intents.collection_metadata_intents_contract_digest_fkey",
      "beforeSha256": null,
      "afterSha256": "5d9de77b0eaa573ea5786e14685d8718542f570f105c5575ae79b8107d3ff1ad",
      "allowIdentityChange": false
    },
    {
      "key": "constraint:public.collection_metadata_intents.collection_metadata_intents_id_fkey",
      "beforeSha256": null,
      "afterSha256": "33552213bab5daed0f14683df6d77b4cce6a68aca28f44c5ea1c2b7ec7a07956",
      "allowIdentityChange": false
    },
    {
      "key": "constraint:public.collection_metadata_intents.collection_metadata_intents_job_id_fkey",
      "beforeSha256": null,
      "afterSha256": "c5f36829dda1787f47ae784549e3c34edad477ef189a9224e416c174baf79753",
      "allowIdentityChange": false
    },
    {
      "key": "constraint:public.collection_metadata_intents.collection_metadata_intents_job_id_key",
      "beforeSha256": null,
      "afterSha256": "638e83d667a7bbb87e5e33cedbcd569881d28008bbd915efe9c5546c48cdbf7b",
      "allowIdentityChange": false
    },
    {
      "key": "constraint:public.collection_metadata_intents.collection_metadata_intents_pkey",
      "beforeSha256": null,
      "afterSha256": "cf58bad888eb88cecd54977d08550ea436b3283d5d483f16e16547195100c75f",
      "allowIdentityChange": false
    },
    {
      "key": "constraint:public.collection_metadata_intents.collection_metadata_intents_prepared_digest_check",
      "beforeSha256": null,
      "afterSha256": "2f68edd96f7490cbb1b75f62cf9e13cb229ef362ba2934f45e47c0fdacf478a7",
      "allowIdentityChange": false
    },
    {
      "key": "constraint:public.collection_metadata_intents.collection_metadata_intents_reservation_id_fkey",
      "beforeSha256": null,
      "afterSha256": "69579be0aa556a2deb9f1fa809fd43b8368c1daada852d6d8c5d9bd255323234",
      "allowIdentityChange": false
    },
    {
      "key": "constraint:public.collection_metadata_intents.collection_metadata_intents_reservation_id_key",
      "beforeSha256": null,
      "afterSha256": "ad62220a361da2635de1c91a5f7ddab5650b9c3f0490d2287d8cb046b1428c93",
      "allowIdentityChange": false
    },
    {
      "key": "constraint:public.collection_metadata_intents.collection_metadata_intents_scope_id_fkey",
      "beforeSha256": null,
      "afterSha256": "84477989bfddef63fc8dfffa8747b902860d7c0ebd8e0cd28375ba301d954773",
      "allowIdentityChange": false
    },
    {
      "key": "constraint:public.collection_metadata_intents.collection_metadata_intents_scope_id_key",
      "beforeSha256": null,
      "afterSha256": "d224f1021b4069c16757fd56a6e5c099b7efdb2b462f32cfedec5c9c556cc040",
      "allowIdentityChange": false
    },
    {
      "key": "constraint:public.collection_metadata_observations.collection_metadata_observations_body_check",
      "beforeSha256": null,
      "afterSha256": "823b88eaebb000185c7b1fbc56a55bce3d0cb69d991e99c06caa0fc21b938134",
      "allowIdentityChange": false
    },
    {
      "key": "constraint:public.collection_metadata_observations.collection_metadata_observations_check",
      "beforeSha256": null,
      "afterSha256": "3f5ba421bf1a5788d78d199c081f026f277f1070d5295619042b48c8c4d17f82",
      "allowIdentityChange": false
    },
    {
      "key": "constraint:public.collection_metadata_observations.collection_metadata_observations_contract_digest_fkey",
      "beforeSha256": null,
      "afterSha256": "5d9de77b0eaa573ea5786e14685d8718542f570f105c5575ae79b8107d3ff1ad",
      "allowIdentityChange": false
    },
    {
      "key": "constraint:public.collection_metadata_observations.collection_metadata_observations_intent_id_fkey",
      "beforeSha256": null,
      "afterSha256": "e631471be2d2699efa42cce526c4a58bff15149814dad86a86d7dfcf0f3d5af4",
      "allowIdentityChange": false
    },
    {
      "key": "constraint:public.collection_metadata_observations.collection_metadata_observations_kind_check",
      "beforeSha256": null,
      "afterSha256": "93cb3e4f9a6e99e0199b5e6c145d9c605836866ecebc0814269f551006da0659",
      "allowIdentityChange": false
    },
    {
      "key": "constraint:public.collection_metadata_observations.collection_metadata_observations_observation_key_check",
      "beforeSha256": null,
      "afterSha256": "ce255e01bfe6b99d1ab453e8be1a943930358a998f4070940a4a8ff23dc0621b",
      "allowIdentityChange": false
    },
    {
      "key": "constraint:public.collection_metadata_observations.collection_metadata_observations_observation_key_key",
      "beforeSha256": null,
      "afterSha256": "0cf51705468e9959d7c85794f2ba5d046ca5c1fbabf2f1933713ee2e76affe62",
      "allowIdentityChange": false
    },
    {
      "key": "constraint:public.collection_metadata_observations.collection_metadata_observations_pkey",
      "beforeSha256": null,
      "afterSha256": "cf58bad888eb88cecd54977d08550ea436b3283d5d483f16e16547195100c75f",
      "allowIdentityChange": false
    },
    {
      "key": "constraint:public.collection_metadata_scopes.collection_metadata_scopes_check",
      "beforeSha256": null,
      "afterSha256": "d14b0dc905ad77aab1c296af45290d54c63aaab8bde6f47bb57964a870318618",
      "allowIdentityChange": false
    },
    {
      "key": "constraint:public.collection_metadata_scopes.collection_metadata_scopes_check1",
      "beforeSha256": null,
      "afterSha256": "3cc4f5cfca508dc3c9eb1aa9253b5864c8f695465d76b2d5cf290e4161fbf9ad",
      "allowIdentityChange": false
    },
    {
      "key": "constraint:public.collection_metadata_scopes.collection_metadata_scopes_check2",
      "beforeSha256": null,
      "afterSha256": "149494e86d8212f980e613b9ff7e4d584b5f5a595740cb406c8562b99cf70fc4",
      "allowIdentityChange": false
    },
    {
      "key": "constraint:public.collection_metadata_scopes.collection_metadata_scopes_check_id_fkey",
      "beforeSha256": null,
      "afterSha256": "b2a8de154282c078aca5ef3adcf015275eaf786b7562e40788619e28dfca00b7",
      "allowIdentityChange": false
    },
    {
      "key": "constraint:public.collection_metadata_scopes.collection_metadata_scopes_contract_digest_fkey",
      "beforeSha256": null,
      "afterSha256": "5d9de77b0eaa573ea5786e14685d8718542f570f105c5575ae79b8107d3ff1ad",
      "allowIdentityChange": false
    },
    {
      "key": "constraint:public.collection_metadata_scopes.collection_metadata_scopes_maximum_calls_check",
      "beforeSha256": null,
      "afterSha256": "c9cbbcd7d99b3432e809af3b43ed2aabbd5ca8f47311dd5a4e17e1816ee4317f",
      "allowIdentityChange": false
    },
    {
      "key": "constraint:public.collection_metadata_scopes.collection_metadata_scopes_maximum_usd_check",
      "beforeSha256": null,
      "afterSha256": "1191a5bdeb20de97c875cd7f6948ca33a23a8e52c10efd16933576ec7c492e09",
      "allowIdentityChange": false
    },
    {
      "key": "constraint:public.collection_metadata_scopes.collection_metadata_scopes_parent_id_fkey",
      "beforeSha256": null,
      "afterSha256": "8f789eeee4cf801be4f5bc23cb75052236f15724ddfd423b969707db46312b31",
      "allowIdentityChange": false
    },
    {
      "key": "constraint:public.collection_metadata_scopes.collection_metadata_scopes_pkey",
      "beforeSha256": null,
      "afterSha256": "cf58bad888eb88cecd54977d08550ea436b3283d5d483f16e16547195100c75f",
      "allowIdentityChange": false
    },
    {
      "key": "constraint:public.collection_metadata_scopes.collection_metadata_scopes_purpose_check",
      "beforeSha256": null,
      "afterSha256": "d55ae12bc9bf455a83a824675124c5c577bf017808165d158fb2c496fa30a6ce",
      "allowIdentityChange": false
    },
    {
      "key": "constraint:public.collection_metadata_scopes.collection_metadata_scopes_user_id_check",
      "beforeSha256": null,
      "afterSha256": "f65aa507001c37b381b9df7a61c01ea5c6d0619b7188b697e2418c6bd67296f0",
      "allowIdentityChange": false
    },
    {
      "key": "constraint:public.collection_metadata_scopes.metadata_fallback_intent",
      "beforeSha256": null,
      "afterSha256": "fc7135e897cbbada20a571aa7cc1e535d9318621a4ee3f6a16d9446d3de1a61c",
      "allowIdentityChange": false
    },
    {
      "key": "constraint:public.collection_retrieval_attempts.collection_retrieval_attempts_item_key_check",
      "beforeSha256": "eafcff1b1876fce2526febeeadfd36b1bdb0f10cae4e74635e039beb202bbb6c",
      "afterSha256": "e6b09d65bb6670f6c2759c034fc5a240a50d452ded4b596c3434d116cc947eec",
      "allowIdentityChange": true
    },
    {
      "key": "constraint:recap_internal.model_provider_diagnostics.model_provider_diagnostics_attempt_number_check",
      "beforeSha256": null,
      "afterSha256": "8e809d24f38d60931ba57cdcc0cd1c95ac0c59a3d59f694015cad9f0337ca5dc",
      "allowIdentityChange": false
    },
    {
      "key": "constraint:recap_internal.model_provider_diagnostics.model_provider_diagnostics_call_id_fkey",
      "beforeSha256": null,
      "afterSha256": "0cdb3bd55446569d2c32dfafe872c9740503df91c4fba0c846eeb485f59a1d88",
      "allowIdentityChange": false
    },
    {
      "key": "constraint:recap_internal.model_provider_diagnostics.model_provider_diagnostics_check",
      "beforeSha256": null,
      "afterSha256": "f0db6c1bc0422de391ee12464e2e7a6e488a27df1b00ef4752cfe39b07cbb744",
      "allowIdentityChange": false
    },
    {
      "key": "constraint:recap_internal.model_provider_diagnostics.model_provider_diagnostics_diagnostic_check",
      "beforeSha256": null,
      "afterSha256": "f96d625d43a6fef5aaf0f5c1c967d432292a95d5ee4eae040f721325bcbf0b0a",
      "allowIdentityChange": false
    },
    {
      "key": "constraint:recap_internal.model_provider_diagnostics.model_provider_diagnostics_error_code_check",
      "beforeSha256": null,
      "afterSha256": "0f64d884249601ef00dfb46e0a948405b9d9c343015070e963f80492a99c1140",
      "allowIdentityChange": false
    },
    {
      "key": "constraint:recap_internal.model_provider_diagnostics.model_provider_diagnostics_pkey",
      "beforeSha256": null,
      "afterSha256": "04e3005328f5081816cfc8de1737add586e190bf8f54752fdc41bf8bacb1d365",
      "allowIdentityChange": false
    },
    {
      "key": "constraint:recap_internal.model_provider_diagnostics.model_provider_diagnostics_request_hash_check",
      "beforeSha256": null,
      "afterSha256": "027246934717ea301c6252e08a6b93aba36c2e87b0977e5badacfeb46e3c089d",
      "allowIdentityChange": false
    },
    {
      "key": "constraint:recap_internal.model_provider_diagnostics.model_provider_diagnostics_session_id_fkey",
      "beforeSha256": null,
      "afterSha256": "26b11b141e6ca4b472fb53d4e8f1de1fbe029bda7eaf00f0b91aeb23609c8584",
      "allowIdentityChange": false
    },
    {
      "key": "definition:accept_hourly_metadata_qualification(text,uuid[],jsonb)",
      "beforeSha256": null,
      "afterSha256": "1800fae9571f603f4e25e9fbee7861d62c0376059c3121d1515d8c78fe09760a",
      "allowIdentityChange": false
    },
    {
      "key": "definition:assert_hourly_metadata_dispatch(uuid,uuid,uuid,jsonb)",
      "beforeSha256": null,
      "afterSha256": "7b229b86a67d9f912bcbfd5e2feda9a934c9bf8b8d934d0c882030b97ca2955c",
      "allowIdentityChange": false
    },
    {
      "key": "definition:finish_hourly_metadata_provider(uuid,uuid,uuid,uuid,jsonb)",
      "beforeSha256": null,
      "afterSha256": "d5d385832da2cfd1a433fe4b8b8905e3a20889cf239fc047c2a9342fd280cf6b",
      "allowIdentityChange": false
    },
    {
      "key": "definition:finish_hourly_source(uuid,uuid,jsonb,jsonb)",
      "beforeSha256": "dcbd1366fe1777b1af8a446e57e5ef367f1c120d740cae5c3cdcc975344478c8",
      "afterSha256": "68c567d71d8f81ad3204cb25f9ea6cb46a26da3154d87e85b46d4ac85dda105e",
      "allowIdentityChange": false
    },
    {
      "key": "definition:immutable_metadata_authority()",
      "beforeSha256": null,
      "afterSha256": "91aea54ad520972b0fc11099472811598e2ab9fea535d85dc13c9e4ecd82d764",
      "allowIdentityChange": false
    },
    {
      "key": "definition:metadata_assert_scope(uuid,uuid,uuid,jsonb,boolean,boolean)",
      "beforeSha256": null,
      "afterSha256": "78c6c854eefedb7fa8d043fb4e0b324f9e0f6a9d04624c1acc88d9122274b170",
      "allowIdentityChange": false
    },
    {
      "key": "definition:metadata_contract_qualified(text)",
      "beforeSha256": null,
      "afterSha256": "bc50199f99c052222d5eec815736b6c2ae2268fa3d9821257aec092a53c6806d",
      "allowIdentityChange": false
    },
    {
      "key": "definition:metadata_intent_document(uuid)",
      "beforeSha256": null,
      "afterSha256": "7ffdbd732cc993670b61bff99662c704ca273f5875e51e52dee4d97f9bed598f",
      "allowIdentityChange": false
    },
    {
      "key": "definition:metadata_native_capability(jsonb,text)",
      "beforeSha256": null,
      "afterSha256": "7f1169b97545d5a72063ea99476283fd4ddd09af259ef1290f4efafc8219509a",
      "allowIdentityChange": false
    },
    {
      "key": "definition:metadata_scope_document(uuid)",
      "beforeSha256": null,
      "afterSha256": "a613a06d3120fc8d5db904a407e5693bfa3cd2172b97b263552d9aae0f49ba1b",
      "allowIdentityChange": false
    },
    {
      "key": "definition:pending_hourly_metadata_providers(uuid,uuid,jsonb)",
      "beforeSha256": null,
      "afterSha256": "3fd86a0d2475d65b465c8a261a39b43577236b37b36f83d2e91797dcf0a06683",
      "allowIdentityChange": false
    },
    {
      "key": "definition:prepare_hourly_metadata_provider(uuid,uuid,uuid,jsonb)",
      "beforeSha256": null,
      "afterSha256": "c47ca72d8bfa88e9b762427b9113605614af43cdacbc234da5d6b20d5a13b548",
      "allowIdentityChange": false
    },
    {
      "key": "definition:prepare_late_provider_fee(uuid)",
      "beforeSha256": "f206f28bcdb412a2e90e3cbe9f370af87641e3afd1c25627c232dfb55502f1a9",
      "afterSha256": "c85906f415301560a8d42fe2942b54929b5c45064001aca44f139976289828c1",
      "allowIdentityChange": false
    },
    {
      "key": "definition:read_hourly_metadata_intent(uuid,jsonb)",
      "beforeSha256": null,
      "afterSha256": "35b6c1dfcdb66bfb20407503cf9731d03867672cab2579e6e542a632f8520479",
      "allowIdentityChange": false
    },
    {
      "key": "definition:recap_internal.fence_model_provider_diagnostic()",
      "beforeSha256": null,
      "afterSha256": "5968f8d703a498c4e0bd7666d06850fc4d712967e1c2d3a898675efad23b4825",
      "allowIdentityChange": false
    },
    {
      "key": "definition:recap_internal.valid_model_provider_diagnostic(jsonb)",
      "beforeSha256": null,
      "afterSha256": "d8a521c28d251cba15a76d7f7e61e5b2f18a89f8c184a0a85fe38af10fc52fba",
      "allowIdentityChange": false
    },
    {
      "key": "definition:record_hourly_metadata_observation(uuid,uuid,uuid,text,jsonb,jsonb)",
      "beforeSha256": null,
      "afterSha256": "980bbd9d02388a70290f223149bf85c5b2d53fbaf45e1fe0ff0c69e011c01eb5",
      "allowIdentityChange": false
    },
    {
      "key": "definition:record_keyword_learning_failure_with_diagnostic(uuid,text,uuid,uuid,text,integer,text,jsonb)",
      "beforeSha256": null,
      "afterSha256": "5d6dd0a702bb044d6ade073e8d67af7465a189447bf9503a16caa612190d9501",
      "allowIdentityChange": false
    },
    {
      "key": "definition:record_late_provider_fee(uuid,text,jsonb,jsonb)",
      "beforeSha256": "f8652823d9687904edf904cfcbd2035e02d2ce267a1e8a69ea0237196d87e9b9",
      "afterSha256": "8a6a3298b6b734d188fee1737c40e6cc2b5f87885b32db873e5942b2326b7047",
      "allowIdentityChange": false
    },
    {
      "key": "definition:reserve_hourly_caption_provider(uuid,uuid,text,uuid,text,numeric,uuid)",
      "beforeSha256": null,
      "afterSha256": "eb715db8a4c9f51cad173174633efeb22c584ed2aece47af77dd0f35c2edaeac",
      "allowIdentityChange": false
    },
    {
      "key": "definition:reserve_hourly_metadata_provider(uuid,uuid,uuid,uuid,text,jsonb,jsonb)",
      "beforeSha256": null,
      "afterSha256": "516d70a3e0b4eb74f43a50fe0b1da79aa7fcfc258cb26bd7b40dc49d35b6376f",
      "allowIdentityChange": false
    },
    {
      "key": "definition:revoke_hourly_metadata_qualification(text,text)",
      "beforeSha256": null,
      "afterSha256": "9945a97f2e347d4c1c205fface2def1e62a181e30625628fd48a736033bd0692",
      "allowIdentityChange": false
    },
    {
      "key": "function:accept_hourly_metadata_qualification(text,uuid[],jsonb)",
      "beforeSha256": null,
      "afterSha256": "cc12447080c7a39ac305843006b772354a1fa6329c44db905600a4af0c403878",
      "allowIdentityChange": false
    },
    {
      "key": "function:assert_hourly_metadata_dispatch(uuid,uuid,uuid,jsonb)",
      "beforeSha256": null,
      "afterSha256": "7d1862875bbaf0edd867df97f8049e150b156495cbe89fa634d71f9124e034e3",
      "allowIdentityChange": false
    },
    {
      "key": "function:finish_hourly_metadata_provider(uuid,uuid,uuid,uuid,jsonb)",
      "beforeSha256": null,
      "afterSha256": "59a99a0b24ff6a426309ed1384f7dbb1e319e22160ba4528c27d3ffed748d84a",
      "allowIdentityChange": false
    },
    {
      "key": "function:immutable_metadata_authority()",
      "beforeSha256": null,
      "afterSha256": "8a465245c6809105f6d6381dd10b8ba8867841a323fac58ddc90307284ca3c1a",
      "allowIdentityChange": false
    },
    {
      "key": "function:metadata_assert_scope(uuid,uuid,uuid,jsonb,boolean,boolean)",
      "beforeSha256": null,
      "afterSha256": "5b951ad9828ae87a1eaf0608383effa2736624c2d1ffae372b42daa3b3280a35",
      "allowIdentityChange": false
    },
    {
      "key": "function:metadata_contract_qualified(text)",
      "beforeSha256": null,
      "afterSha256": "33d3347150e4dfe15f862f4bd0238fdaae0c4d01ccfee1bc001fdde1811572cc",
      "allowIdentityChange": false
    },
    {
      "key": "function:metadata_intent_document(uuid)",
      "beforeSha256": null,
      "afterSha256": "bf6d2a49046f28da6a785eb4a744324db455aa1a6d35690e4cc08c65e22cc8a7",
      "allowIdentityChange": false
    },
    {
      "key": "function:metadata_native_capability(jsonb,text)",
      "beforeSha256": null,
      "afterSha256": "924e7098335109fa1811cf10bb3f5383f9501ded15a70d3def9f2b67ac2512dc",
      "allowIdentityChange": false
    },
    {
      "key": "function:metadata_scope_document(uuid)",
      "beforeSha256": null,
      "afterSha256": "b71afdffbd35cd4082129bf825658e62de89f71a22cb086bd20f3d9ef0da9e0a",
      "allowIdentityChange": false
    },
    {
      "key": "function:pending_hourly_metadata_providers(uuid,uuid,jsonb)",
      "beforeSha256": null,
      "afterSha256": "c23048148984ce1484d234cb97dce532d7c8b907d5d62dd43a014234ceeb8435",
      "allowIdentityChange": false
    },
    {
      "key": "function:prepare_hourly_metadata_provider(uuid,uuid,uuid,jsonb)",
      "beforeSha256": null,
      "afterSha256": "920c3c0f3a965815b19285463055e659532da57167365b86612bbc5f42bc7b18",
      "allowIdentityChange": false
    },
    {
      "key": "function:read_hourly_metadata_intent(uuid,jsonb)",
      "beforeSha256": null,
      "afterSha256": "aceed5fdabd5cab12a766380160cb48c0bae728a0efe354554fc2e246d1234b8",
      "allowIdentityChange": false
    },
    {
      "key": "function:recap_internal.fence_model_provider_diagnostic()",
      "beforeSha256": null,
      "afterSha256": "35ce914021dfa0a27404730997d6e96368c55d8d94833b4b5dd0af010e533ff1",
      "allowIdentityChange": false
    },
    {
      "key": "function:recap_internal.valid_model_provider_diagnostic(jsonb)",
      "beforeSha256": null,
      "afterSha256": "94f2790417d3d983bcf133d9863678446c798b9fbca1b7c773d7d39274cf4e68",
      "allowIdentityChange": false
    },
    {
      "key": "function:record_hourly_metadata_observation(uuid,uuid,uuid,text,jsonb,jsonb)",
      "beforeSha256": null,
      "afterSha256": "520b8d31b33b757728fdaab1be2f0240abacb449d02155afadf0a4ddce49d822",
      "allowIdentityChange": false
    },
    {
      "key": "function:record_keyword_learning_failure_with_diagnostic(uuid,text,uuid,uuid,text,integer,text,jsonb)",
      "beforeSha256": null,
      "afterSha256": "7a80b2d20fcd9957b53dd3c1ecb856a323c788ba751ff1a4286b14baa64fb1a8",
      "allowIdentityChange": false
    },
    {
      "key": "function:reserve_hourly_caption_provider(uuid,uuid,text,uuid,text,numeric,uuid)",
      "beforeSha256": null,
      "afterSha256": "181b71b37d63ca9514b4e60a9cfed1979d3827e5f786ee00ffffb29b481e7c4e",
      "allowIdentityChange": false
    },
    {
      "key": "function:reserve_hourly_metadata_provider(uuid,uuid,uuid,uuid,text,jsonb,jsonb)",
      "beforeSha256": null,
      "afterSha256": "1a2364dde5cbf8314cb805527d4109ef6700f9362519f8cd22999dc24db5f0f8",
      "allowIdentityChange": false
    },
    {
      "key": "function:revoke_hourly_metadata_qualification(text,text)",
      "beforeSha256": null,
      "afterSha256": "331b9c4d9dae724f63da3adc670a7558e58903465701bffa920ab3378a143ebd",
      "allowIdentityChange": false
    },
    {
      "key": "index:public.collection_metadata_contracts_pkey",
      "beforeSha256": null,
      "afterSha256": "500045dd3d7502e15672daf2331e8a92b2e32b1db71444b8aabae1db48ea92fa",
      "allowIdentityChange": false
    },
    {
      "key": "index:public.collection_metadata_intents_job_id_key",
      "beforeSha256": null,
      "afterSha256": "fd412b17844331c8e6887610727eb8124409d27573381823029de45c3f9e7982",
      "allowIdentityChange": false
    },
    {
      "key": "index:public.collection_metadata_intents_pkey",
      "beforeSha256": null,
      "afterSha256": "e6b619f62b0c94b5c4ed76c0c3a9d3d656f1352c52f9a734ecc3ff898bc46b73",
      "allowIdentityChange": false
    },
    {
      "key": "index:public.collection_metadata_intents_reservation_id_key",
      "beforeSha256": null,
      "afterSha256": "1ea2d89b77f64f91d5153e94ed20bf8e4e18435157c7483da43c9a4ded60fb2d",
      "allowIdentityChange": false
    },
    {
      "key": "index:public.collection_metadata_intents_scope_id_key",
      "beforeSha256": null,
      "afterSha256": "cb2881472c6d5a7b1539436cdf997804aea5b6bb0484aada7a3915475d1dc629",
      "allowIdentityChange": false
    },
    {
      "key": "index:public.collection_metadata_observations_observation_key_key",
      "beforeSha256": null,
      "afterSha256": "15ef7c47b8c041e85016444617f3c893f4c610c596b5c336d316c22e7d605374",
      "allowIdentityChange": false
    },
    {
      "key": "index:public.collection_metadata_observations_pkey",
      "beforeSha256": null,
      "afterSha256": "8c0c8df6292087015cd08053294cd6abbaf9876dc43e8a6d6353be7d97c315dd",
      "allowIdentityChange": false
    },
    {
      "key": "index:public.collection_metadata_scopes_pkey",
      "beforeSha256": null,
      "afterSha256": "0c57bc920104f3e181192a4c50493cad9cfa78d3f20a98a2826f6cd4cc3e8eb2",
      "allowIdentityChange": false
    },
    {
      "key": "index:public.metadata_intents_contract",
      "beforeSha256": null,
      "afterSha256": "58a516367df4bb86dbf98aa0c2384d391616e102a862cd2f55b0781bdf81ddc8",
      "allowIdentityChange": false
    },
    {
      "key": "index:public.metadata_observations_intent",
      "beforeSha256": null,
      "afterSha256": "3cdb43df3921806eeda22b27f4b5efafdc39fe404f0e68f557ad88696f50969a",
      "allowIdentityChange": false
    },
    {
      "key": "index:public.metadata_observations_qualification",
      "beforeSha256": null,
      "afterSha256": "573539c0d52d8bb968d38d89fee9e1c4d8eb5f670a27b09ab57c2cc5c15fac98",
      "allowIdentityChange": false
    },
    {
      "key": "index:recap_internal.model_provider_diagnostics_pkey",
      "beforeSha256": null,
      "afterSha256": "4eefdde236f097a4dfc6153026fbfd86fd5b0b2d719e9926ca7a0b721d170e86",
      "allowIdentityChange": false
    },
    {
      "key": "index:recap_internal.model_provider_diagnostics_session_idx",
      "beforeSha256": null,
      "afterSha256": "190bdfb05608e928dd5606cfff5958d1d99927ca1e4f863325fb88fd315bedff",
      "allowIdentityChange": false
    },
    {
      "key": "relation:public.collection_metadata_contracts",
      "beforeSha256": null,
      "afterSha256": "4f778cf1c9f7eba9f24ff39dc8ec9e8ad7f989b9a74e0b034f35e39975168e1b",
      "allowIdentityChange": false
    },
    {
      "key": "relation:public.collection_metadata_contracts_pkey",
      "beforeSha256": null,
      "afterSha256": "e3f5012e8e548f8cde0a97b254b6e7eb285f59a6e78ecd6097962389f32b4477",
      "allowIdentityChange": false
    },
    {
      "key": "relation:public.collection_metadata_intents",
      "beforeSha256": null,
      "afterSha256": "4f778cf1c9f7eba9f24ff39dc8ec9e8ad7f989b9a74e0b034f35e39975168e1b",
      "allowIdentityChange": false
    },
    {
      "key": "relation:public.collection_metadata_intents_job_id_key",
      "beforeSha256": null,
      "afterSha256": "e3f5012e8e548f8cde0a97b254b6e7eb285f59a6e78ecd6097962389f32b4477",
      "allowIdentityChange": false
    },
    {
      "key": "relation:public.collection_metadata_intents_pkey",
      "beforeSha256": null,
      "afterSha256": "e3f5012e8e548f8cde0a97b254b6e7eb285f59a6e78ecd6097962389f32b4477",
      "allowIdentityChange": false
    },
    {
      "key": "relation:public.collection_metadata_intents_reservation_id_key",
      "beforeSha256": null,
      "afterSha256": "e3f5012e8e548f8cde0a97b254b6e7eb285f59a6e78ecd6097962389f32b4477",
      "allowIdentityChange": false
    },
    {
      "key": "relation:public.collection_metadata_intents_scope_id_key",
      "beforeSha256": null,
      "afterSha256": "e3f5012e8e548f8cde0a97b254b6e7eb285f59a6e78ecd6097962389f32b4477",
      "allowIdentityChange": false
    },
    {
      "key": "relation:public.collection_metadata_observations",
      "beforeSha256": null,
      "afterSha256": "4f778cf1c9f7eba9f24ff39dc8ec9e8ad7f989b9a74e0b034f35e39975168e1b",
      "allowIdentityChange": false
    },
    {
      "key": "relation:public.collection_metadata_observations_observation_key_key",
      "beforeSha256": null,
      "afterSha256": "e3f5012e8e548f8cde0a97b254b6e7eb285f59a6e78ecd6097962389f32b4477",
      "allowIdentityChange": false
    },
    {
      "key": "relation:public.collection_metadata_observations_pkey",
      "beforeSha256": null,
      "afterSha256": "e3f5012e8e548f8cde0a97b254b6e7eb285f59a6e78ecd6097962389f32b4477",
      "allowIdentityChange": false
    },
    {
      "key": "relation:public.collection_metadata_scopes",
      "beforeSha256": null,
      "afterSha256": "4f778cf1c9f7eba9f24ff39dc8ec9e8ad7f989b9a74e0b034f35e39975168e1b",
      "allowIdentityChange": false
    },
    {
      "key": "relation:public.collection_metadata_scopes_pkey",
      "beforeSha256": null,
      "afterSha256": "e3f5012e8e548f8cde0a97b254b6e7eb285f59a6e78ecd6097962389f32b4477",
      "allowIdentityChange": false
    },
    {
      "key": "relation:public.metadata_intents_contract",
      "beforeSha256": null,
      "afterSha256": "e3f5012e8e548f8cde0a97b254b6e7eb285f59a6e78ecd6097962389f32b4477",
      "allowIdentityChange": false
    },
    {
      "key": "relation:public.metadata_observations_intent",
      "beforeSha256": null,
      "afterSha256": "e3f5012e8e548f8cde0a97b254b6e7eb285f59a6e78ecd6097962389f32b4477",
      "allowIdentityChange": false
    },
    {
      "key": "relation:public.metadata_observations_qualification",
      "beforeSha256": null,
      "afterSha256": "e3f5012e8e548f8cde0a97b254b6e7eb285f59a6e78ecd6097962389f32b4477",
      "allowIdentityChange": false
    },
    {
      "key": "relation:recap_internal.model_provider_diagnostics",
      "beforeSha256": null,
      "afterSha256": "047e3d421b1683270fbbd9a46a37a02252a78a41068b806f423ab57635f177c0",
      "allowIdentityChange": false
    },
    {
      "key": "relation:recap_internal.model_provider_diagnostics_pkey",
      "beforeSha256": null,
      "afterSha256": "e3f5012e8e548f8cde0a97b254b6e7eb285f59a6e78ecd6097962389f32b4477",
      "allowIdentityChange": false
    },
    {
      "key": "relation:recap_internal.model_provider_diagnostics_session_idx",
      "beforeSha256": null,
      "afterSha256": "e3f5012e8e548f8cde0a97b254b6e7eb285f59a6e78ecd6097962389f32b4477",
      "allowIdentityChange": false
    },
    {
      "key": "trigger:public.collection_budget_reservations.internal:collection_metadata_intents_reservation_id_fkey:\"RI_FKey_noaction_del\"():9",
      "beforeSha256": null,
      "afterSha256": "bb7b851c71b5cbf7f5e2ed999e5c1a600f55c8e93367408ac5e3a548643460eb",
      "allowIdentityChange": false
    },
    {
      "key": "trigger:public.collection_budget_reservations.internal:collection_metadata_intents_reservation_id_fkey:\"RI_FKey_noaction_upd\"():17",
      "beforeSha256": null,
      "afterSha256": "a7a35bb55afcbc9359448a791576ed268ca7012012a2815b1189690071e1c11d",
      "allowIdentityChange": false
    },
    {
      "key": "trigger:public.collection_jobs.internal:collection_metadata_intents_job_id_fkey:\"RI_FKey_noaction_del\"():9",
      "beforeSha256": null,
      "afterSha256": "babaa85a84686cb648e493df7753f2f86ed6ea6625d8560114b094910fa3747d",
      "allowIdentityChange": false
    },
    {
      "key": "trigger:public.collection_jobs.internal:collection_metadata_intents_job_id_fkey:\"RI_FKey_noaction_upd\"():17",
      "beforeSha256": null,
      "afterSha256": "13b5dcc9c8a63b4d0f493b33cb7c83b515cf3aeb6fcd17ec73c79cd03274d334",
      "allowIdentityChange": false
    },
    {
      "key": "trigger:public.collection_metadata_contracts.immutable_metadata_contracts",
      "beforeSha256": null,
      "afterSha256": "e5ecd6887e59b08b0ef86468e2183c316773c053f048821abeb5a04c99186945",
      "allowIdentityChange": false
    },
    {
      "key": "trigger:public.collection_metadata_contracts.internal:collection_metadata_intents_contract_digest_fkey:\"RI_FKey_noaction_del\"():9",
      "beforeSha256": null,
      "afterSha256": "43fb8137f613bac0fc1452376bcfea8a38c05d381d777bc5929a2eac47e9a642",
      "allowIdentityChange": false
    },
    {
      "key": "trigger:public.collection_metadata_contracts.internal:collection_metadata_intents_contract_digest_fkey:\"RI_FKey_noaction_upd\"():17",
      "beforeSha256": null,
      "afterSha256": "81a0bdbc55df76107983be2f86dbdb25d46c66da2215bb6b7804837d53cb522f",
      "allowIdentityChange": false
    },
    {
      "key": "trigger:public.collection_metadata_contracts.internal:collection_metadata_observations_contract_digest_fkey:\"RI_FKey_noaction_del\"():9",
      "beforeSha256": null,
      "afterSha256": "3c39079719227fb2c5b27368f5d2df95314a02559388c9ca3e8e0e94329bfdaf",
      "allowIdentityChange": false
    },
    {
      "key": "trigger:public.collection_metadata_contracts.internal:collection_metadata_observations_contract_digest_fkey:\"RI_FKey_noaction_upd\"():17",
      "beforeSha256": null,
      "afterSha256": "d93fda41fb174cd72803d7d46e1d5a666008c0707b4114d2a2b47f06af203329",
      "allowIdentityChange": false
    },
    {
      "key": "trigger:public.collection_metadata_contracts.internal:collection_metadata_scopes_contract_digest_fkey:\"RI_FKey_noaction_del\"():9",
      "beforeSha256": null,
      "afterSha256": "4377f048525801eed966ab0e968b5da4cc8bd0031ebfca53b8c2f0632f757b31",
      "allowIdentityChange": false
    },
    {
      "key": "trigger:public.collection_metadata_contracts.internal:collection_metadata_scopes_contract_digest_fkey:\"RI_FKey_noaction_upd\"():17",
      "beforeSha256": null,
      "afterSha256": "a3c58770055249092d8719c49aadd71921a32fb632d78c6b6d08e0dde52a1f58",
      "allowIdentityChange": false
    },
    {
      "key": "trigger:public.collection_metadata_intents.immutable_metadata_intents",
      "beforeSha256": null,
      "afterSha256": "e2dd26b79b2646ec3b0a554e91b6e374da3b133c51ea2bc622c3af89dfa4032b",
      "allowIdentityChange": false
    },
    {
      "key": "trigger:public.collection_metadata_intents.internal:collection_metadata_intents_check_id_fkey:\"RI_FKey_check_ins\"():5",
      "beforeSha256": null,
      "afterSha256": "57e055a76a0179819111421e6bf7eb2810a038a0c28e64cd8b34ba100b1c87f7",
      "allowIdentityChange": false
    },
    {
      "key": "trigger:public.collection_metadata_intents.internal:collection_metadata_intents_check_id_fkey:\"RI_FKey_check_upd\"():17",
      "beforeSha256": null,
      "afterSha256": "6dff444cb509e1b1df0665fbf6e93cf5a0c8d4e7ef04cfe5c96cd9815c416226",
      "allowIdentityChange": false
    },
    {
      "key": "trigger:public.collection_metadata_intents.internal:collection_metadata_intents_contract_digest_fkey:\"RI_FKey_check_ins\"():5",
      "beforeSha256": null,
      "afterSha256": "2e138de5c75be6080f05f7b0a8889a9529feb7f2fc692821bf3db1d7563b92c6",
      "allowIdentityChange": false
    },
    {
      "key": "trigger:public.collection_metadata_intents.internal:collection_metadata_intents_contract_digest_fkey:\"RI_FKey_check_upd\"():17",
      "beforeSha256": null,
      "afterSha256": "420f899ee04f0e19213aa94f888fc88876fee59b376da584ddbab94cf1349639",
      "allowIdentityChange": false
    },
    {
      "key": "trigger:public.collection_metadata_intents.internal:collection_metadata_intents_id_fkey:\"RI_FKey_check_ins\"():5",
      "beforeSha256": null,
      "afterSha256": "56c831bdb13ad2ded481d66793ab17fd6e7996ddaf5c4531c17a93fec27cb001",
      "allowIdentityChange": false
    },
    {
      "key": "trigger:public.collection_metadata_intents.internal:collection_metadata_intents_id_fkey:\"RI_FKey_check_upd\"():17",
      "beforeSha256": null,
      "afterSha256": "2bd1f81f17398437f1a8ba4f60416420656fe55b9a5089d09674a49f5242dcfe",
      "allowIdentityChange": false
    },
    {
      "key": "trigger:public.collection_metadata_intents.internal:collection_metadata_intents_job_id_fkey:\"RI_FKey_check_ins\"():5",
      "beforeSha256": null,
      "afterSha256": "6ebe828f7662e479ae85c1454332251fe37355c2f412ce1d50a32673342f7fd9",
      "allowIdentityChange": false
    },
    {
      "key": "trigger:public.collection_metadata_intents.internal:collection_metadata_intents_job_id_fkey:\"RI_FKey_check_upd\"():17",
      "beforeSha256": null,
      "afterSha256": "380ae4019db95567e4589917bb80b65c5fdb8af55dc94bd763229f9f97f70b18",
      "allowIdentityChange": false
    },
    {
      "key": "trigger:public.collection_metadata_intents.internal:collection_metadata_intents_reservation_id_fkey:\"RI_FKey_check_ins\"():5",
      "beforeSha256": null,
      "afterSha256": "944bdc97b73441248a9a459febf8eb45d2dce6e56fd48f66357e1fd93f5394a3",
      "allowIdentityChange": false
    },
    {
      "key": "trigger:public.collection_metadata_intents.internal:collection_metadata_intents_reservation_id_fkey:\"RI_FKey_check_upd\"():17",
      "beforeSha256": null,
      "afterSha256": "84787c871c6055d46aa83aebc3c20949f5142b91de06cb08f5e7c8cb4e19417c",
      "allowIdentityChange": false
    },
    {
      "key": "trigger:public.collection_metadata_intents.internal:collection_metadata_intents_scope_id_fkey:\"RI_FKey_check_ins\"():5",
      "beforeSha256": null,
      "afterSha256": "c81ee0e3df49f8330c70dbd25f0f62b4cc81985e207694f6dfa33c06e0e849b1",
      "allowIdentityChange": false
    },
    {
      "key": "trigger:public.collection_metadata_intents.internal:collection_metadata_intents_scope_id_fkey:\"RI_FKey_check_upd\"():17",
      "beforeSha256": null,
      "afterSha256": "18bad152e22f371bee459ec446394e4feb523256e6fe6556377c446803920400",
      "allowIdentityChange": false
    },
    {
      "key": "trigger:public.collection_metadata_intents.internal:collection_metadata_observations_intent_id_fkey:\"RI_FKey_noaction_del\"():9",
      "beforeSha256": null,
      "afterSha256": "c24f9eaf4bf9b22e669c319083832d736bdd05a702150ff5133222aab1a25786",
      "allowIdentityChange": false
    },
    {
      "key": "trigger:public.collection_metadata_intents.internal:collection_metadata_observations_intent_id_fkey:\"RI_FKey_noaction_upd\"():17",
      "beforeSha256": null,
      "afterSha256": "838cc850d9dd490f0e5ac3a3dfcb9bff2dc7b819b6462f038d57656d9cc17c44",
      "allowIdentityChange": false
    },
    {
      "key": "trigger:public.collection_metadata_intents.internal:metadata_fallback_intent:\"RI_FKey_noaction_del\"():9",
      "beforeSha256": null,
      "afterSha256": "5d82199da1dc903cdc67232ccc73ef93844cf7f8954edc0807965c7edd93aec2",
      "allowIdentityChange": false
    },
    {
      "key": "trigger:public.collection_metadata_intents.internal:metadata_fallback_intent:\"RI_FKey_noaction_upd\"():17",
      "beforeSha256": null,
      "afterSha256": "623a3a3f7d90eeb3bd393b3e1f73f314faeda4c2ea25eef84e723d93c938a8e5",
      "allowIdentityChange": false
    },
    {
      "key": "trigger:public.collection_metadata_observations.immutable_metadata_observations",
      "beforeSha256": null,
      "afterSha256": "c5da4ae7e33ccf6ea2531ef451eaaf65aed8cbcf5ca38783cb34a144c51b2308",
      "allowIdentityChange": false
    },
    {
      "key": "trigger:public.collection_metadata_observations.internal:collection_metadata_observations_contract_digest_fkey:\"RI_FKey_check_ins\"():5",
      "beforeSha256": null,
      "afterSha256": "446cfca43732747f9a929b98d5779e6df6597a14adba4204a0a2c58837d4aabf",
      "allowIdentityChange": false
    },
    {
      "key": "trigger:public.collection_metadata_observations.internal:collection_metadata_observations_contract_digest_fkey:\"RI_FKey_check_upd\"():17",
      "beforeSha256": null,
      "afterSha256": "aed4c7a1be127d856a6589495d88d538f7ba3dd3793f0c7a74d08e1626abdc69",
      "allowIdentityChange": false
    },
    {
      "key": "trigger:public.collection_metadata_observations.internal:collection_metadata_observations_intent_id_fkey:\"RI_FKey_check_ins\"():5",
      "beforeSha256": null,
      "afterSha256": "1c35c0976f42b6948daa81f434701001fe1e00b06850452e032e03f9889a6927",
      "allowIdentityChange": false
    },
    {
      "key": "trigger:public.collection_metadata_observations.internal:collection_metadata_observations_intent_id_fkey:\"RI_FKey_check_upd\"():17",
      "beforeSha256": null,
      "afterSha256": "93557e984868b8611b35fc4d459375664415985094289f90436f78fff8189f80",
      "allowIdentityChange": false
    },
    {
      "key": "trigger:public.collection_metadata_scopes.immutable_metadata_scopes",
      "beforeSha256": null,
      "afterSha256": "cc709c745cbf3e04ee9001fecd13a9c9bb5fd4dcd7d89cf9bb5231dc0d027644",
      "allowIdentityChange": false
    },
    {
      "key": "trigger:public.collection_metadata_scopes.internal:collection_metadata_intents_scope_id_fkey:\"RI_FKey_noaction_del\"():9",
      "beforeSha256": null,
      "afterSha256": "24ee899e5c05d2c3f914003e77667c7b5cc32b9d4368a72eca4395088895256e",
      "allowIdentityChange": false
    },
    {
      "key": "trigger:public.collection_metadata_scopes.internal:collection_metadata_intents_scope_id_fkey:\"RI_FKey_noaction_upd\"():17",
      "beforeSha256": null,
      "afterSha256": "e2e916f07fd5ed9884d1de8d0017516990d4d9c8e78961098b92b8915225fb03",
      "allowIdentityChange": false
    },
    {
      "key": "trigger:public.collection_metadata_scopes.internal:collection_metadata_scopes_check_id_fkey:\"RI_FKey_check_ins\"():5",
      "beforeSha256": null,
      "afterSha256": "701539434c316db1e13d9ca03a961923baf423e83301ba6fc04b5751fb9abd79",
      "allowIdentityChange": false
    },
    {
      "key": "trigger:public.collection_metadata_scopes.internal:collection_metadata_scopes_check_id_fkey:\"RI_FKey_check_upd\"():17",
      "beforeSha256": null,
      "afterSha256": "e6a23f6e49278e7ae8a800c66506a5d4255ca4c1eeef14aad79d8b3f5b254fdf",
      "allowIdentityChange": false
    },
    {
      "key": "trigger:public.collection_metadata_scopes.internal:collection_metadata_scopes_contract_digest_fkey:\"RI_FKey_check_ins\"():5",
      "beforeSha256": null,
      "afterSha256": "9d420b1480f3fe463b245583f6dbad855c1965d6e27420e6ca9ae3aeb68b15ab",
      "allowIdentityChange": false
    },
    {
      "key": "trigger:public.collection_metadata_scopes.internal:collection_metadata_scopes_contract_digest_fkey:\"RI_FKey_check_upd\"():17",
      "beforeSha256": null,
      "afterSha256": "9e88f332301e59c79b65f9208830db342d6a052753507e73f49c3e2065fd7d38",
      "allowIdentityChange": false
    },
    {
      "key": "trigger:public.collection_metadata_scopes.internal:collection_metadata_scopes_parent_id_fkey:\"RI_FKey_check_ins\"():5",
      "beforeSha256": null,
      "afterSha256": "4441e5cb095e85af2dc209829be391b7c2827082fe191c6b9571941904f7791a",
      "allowIdentityChange": false
    },
    {
      "key": "trigger:public.collection_metadata_scopes.internal:collection_metadata_scopes_parent_id_fkey:\"RI_FKey_check_upd\"():17",
      "beforeSha256": null,
      "afterSha256": "94078867238977594f1fb476d8501eebb738cd9e8613afc51967fcca4b0ee86e",
      "allowIdentityChange": false
    },
    {
      "key": "trigger:public.collection_metadata_scopes.internal:collection_metadata_scopes_parent_id_fkey:\"RI_FKey_noaction_del\"():9",
      "beforeSha256": null,
      "afterSha256": "b8f5a612f3e50662d6b21bcc9c870eecd136701dca911e45ac2b78059a806407",
      "allowIdentityChange": false
    },
    {
      "key": "trigger:public.collection_metadata_scopes.internal:collection_metadata_scopes_parent_id_fkey:\"RI_FKey_noaction_upd\"():17",
      "beforeSha256": null,
      "afterSha256": "eb4499865ebac20e089acf2e2ddf417961fc0bd1e87d0d1054236e7ec25e0af5",
      "allowIdentityChange": false
    },
    {
      "key": "trigger:public.collection_metadata_scopes.internal:metadata_fallback_intent:\"RI_FKey_check_ins\"():5",
      "beforeSha256": null,
      "afterSha256": "8af204c01ae87fd99ba016d07b5c93d4d2d7b27206459eb66ff60f32a457b55a",
      "allowIdentityChange": false
    },
    {
      "key": "trigger:public.collection_metadata_scopes.internal:metadata_fallback_intent:\"RI_FKey_check_upd\"():17",
      "beforeSha256": null,
      "afterSha256": "601801e82b7464140d34357d0b6308b0d004b0e20fb2c80980280116084a66c5",
      "allowIdentityChange": false
    },
    {
      "key": "trigger:public.keyword_learning_sessions.internal:model_provider_diagnostics_session_id_fkey:\"RI_FKey_cascade_del\"():9",
      "beforeSha256": null,
      "afterSha256": "1bfc91def2a857dc780feab1cc74029f729f09e89a1725386315563d0a6388a9",
      "allowIdentityChange": false
    },
    {
      "key": "trigger:public.keyword_learning_sessions.internal:model_provider_diagnostics_session_id_fkey:\"RI_FKey_noaction_upd\"():17",
      "beforeSha256": null,
      "afterSha256": "dffed87805c6806ba59e038fb6704c2dc541f06cb26a3be41802ac91e386ad9e",
      "allowIdentityChange": false
    },
    {
      "key": "trigger:public.reader_collection_checks.internal:collection_metadata_intents_check_id_fkey:\"RI_FKey_noaction_del\"():9",
      "beforeSha256": null,
      "afterSha256": "d983919f33e20dc4904bc598bc231e51dc27c847e92cc1519d92743d0a896456",
      "allowIdentityChange": false
    },
    {
      "key": "trigger:public.reader_collection_checks.internal:collection_metadata_intents_check_id_fkey:\"RI_FKey_noaction_upd\"():17",
      "beforeSha256": null,
      "afterSha256": "a0eea0ba2bc13c64114e14b55eb99c5c575d16b6af9add7f7496ca0a056cd168",
      "allowIdentityChange": false
    },
    {
      "key": "trigger:public.reader_collection_checks.internal:collection_metadata_scopes_check_id_fkey:\"RI_FKey_noaction_del\"():9",
      "beforeSha256": null,
      "afterSha256": "1fc0d35da4fd782fbbff9946a7a7f86dc9db0cc9af56ac984e56a5a06b2f6039",
      "allowIdentityChange": false
    },
    {
      "key": "trigger:public.reader_collection_checks.internal:collection_metadata_scopes_check_id_fkey:\"RI_FKey_noaction_upd\"():17",
      "beforeSha256": null,
      "afterSha256": "b81ad33262de1e9d1b80d8ff69901e58eeba678cb1f9400e7496328be6ef07c1",
      "allowIdentityChange": false
    },
    {
      "key": "trigger:public.reader_collection_provider_jobs.internal:collection_metadata_intents_id_fkey:\"RI_FKey_noaction_del\"():9",
      "beforeSha256": null,
      "afterSha256": "f6e1d31a21f344380a96a718ec1f9ce102b5a383cb82ae8343c725f5b7b93d37",
      "allowIdentityChange": false
    },
    {
      "key": "trigger:public.reader_collection_provider_jobs.internal:collection_metadata_intents_id_fkey:\"RI_FKey_noaction_upd\"():17",
      "beforeSha256": null,
      "afterSha256": "160c79108f14ccd3d8518c7470a2c3e1e2eea970ee522ec4e7f5c17bf3f5048a",
      "allowIdentityChange": false
    },
    {
      "key": "trigger:public.reader_content_analysis_calls.internal:model_provider_diagnostics_call_id_fkey:\"RI_FKey_cascade_del\"():9",
      "beforeSha256": null,
      "afterSha256": "da9faf7cad33ce05388fd8e8390300f3c16236c0caaace308d41a7d4a8b91bdc",
      "allowIdentityChange": false
    },
    {
      "key": "trigger:public.reader_content_analysis_calls.internal:model_provider_diagnostics_call_id_fkey:\"RI_FKey_noaction_upd\"():17",
      "beforeSha256": null,
      "afterSha256": "b2063167e6beb5e774c4c2da184e7fb3083eecc4338d178a5436e4a9c8b16751",
      "allowIdentityChange": false
    },
    {
      "key": "trigger:recap_internal.model_provider_diagnostics.internal:model_provider_diagnostics_call_id_fkey:\"RI_FKey_check_ins\"():5",
      "beforeSha256": null,
      "afterSha256": "08b47853cbf835ed7f21d3af1d331759d4f957d8d9d71e03a0f18cbbba69d440",
      "allowIdentityChange": false
    },
    {
      "key": "trigger:recap_internal.model_provider_diagnostics.internal:model_provider_diagnostics_call_id_fkey:\"RI_FKey_check_upd\"():17",
      "beforeSha256": null,
      "afterSha256": "811898309fbc24d4b45bfade5578c065322ce4dde64611b7ec8b1450e978fc5b",
      "allowIdentityChange": false
    },
    {
      "key": "trigger:recap_internal.model_provider_diagnostics.internal:model_provider_diagnostics_session_id_fkey:\"RI_FKey_check_ins\"():5",
      "beforeSha256": null,
      "afterSha256": "ebc72f52875d8402ff4b334ca15b5d661e0a7764b57bfcac99c78e9940f1b295",
      "allowIdentityChange": false
    },
    {
      "key": "trigger:recap_internal.model_provider_diagnostics.internal:model_provider_diagnostics_session_id_fkey:\"RI_FKey_check_upd\"():17",
      "beforeSha256": null,
      "afterSha256": "bf12fa11a3fad41826ae3b82310efa2cdecde780b6d2857a50ed154b15535498",
      "allowIdentityChange": false
    },
    {
      "key": "trigger:recap_internal.model_provider_diagnostics.model_provider_diagnostic_fence",
      "beforeSha256": null,
      "afterSha256": "13683b2e81cad792a1ccfe695b876a28abb85b12895025eb87a81ffe0f2bcee2",
      "allowIdentityChange": false
    },
    {
      "key": "type:public._collection_metadata_contracts",
      "beforeSha256": null,
      "afterSha256": "26d2789946f47a2c965da5c53314be9a3abe34f5b5f099bf30234f7baffc53c6",
      "allowIdentityChange": false
    },
    {
      "key": "type:public._collection_metadata_intents",
      "beforeSha256": null,
      "afterSha256": "5151db7df073539c0a60b1d602ba6336eda80093dd4b25a95e21f88c1807b70f",
      "allowIdentityChange": false
    },
    {
      "key": "type:public._collection_metadata_observations",
      "beforeSha256": null,
      "afterSha256": "ca989d2b5a419716af21cfe47e9a595c806a0796ccdc3aa191f0fafbea55e974",
      "allowIdentityChange": false
    },
    {
      "key": "type:public._collection_metadata_scopes",
      "beforeSha256": null,
      "afterSha256": "d25fa52501b0dddd2feae41c41753b51372ac4fcc88ffaae0a588edaa1ff0d7c",
      "allowIdentityChange": false
    },
    {
      "key": "type:public.collection_metadata_contracts",
      "beforeSha256": null,
      "afterSha256": "b2245e10accbdaeaa8962cf440066a9aa6316b6a8577262c5b79946e2b08818a",
      "allowIdentityChange": false
    },
    {
      "key": "type:public.collection_metadata_intents",
      "beforeSha256": null,
      "afterSha256": "43b4f7cd4dc5805deeecbfafc605b74a812a82a05106dd86654ae607b45b62cc",
      "allowIdentityChange": false
    },
    {
      "key": "type:public.collection_metadata_observations",
      "beforeSha256": null,
      "afterSha256": "92e10b947bf4d7d704793313af2d017d5e3ea77f08938c0a8bcc17357f7c70fc",
      "allowIdentityChange": false
    },
    {
      "key": "type:public.collection_metadata_scopes",
      "beforeSha256": null,
      "afterSha256": "d4cd96ff5d462b919fe1f31ff3ec9b902f7eede1b4fe41f341ec9a9879328381",
      "allowIdentityChange": false
    },
    {
      "key": "type:recap_internal._model_provider_diagnostics",
      "beforeSha256": null,
      "afterSha256": "65b335fee82c7e11278a68b0f0053da07e581540d87bb7f1429c1c59179b7a7f",
      "allowIdentityChange": false
    },
    {
      "key": "type:recap_internal.model_provider_diagnostics",
      "beforeSha256": null,
      "afterSha256": "8663bfafba18aef9245e9e7d6bf7b6cc57fa6a4535c0465c142982abc08fe004",
      "allowIdentityChange": false
    },
    {
      "key": "relation:public.reader_content_analysis_calls",
      "beforeSha256": "182937fc5a02118102d68fafe27e3d18541fa5ae79f13e9629717448cd7d1f2c",
      "afterSha256": "182937fc5a02118102d68fafe27e3d18541fa5ae79f13e9629717448cd7d1f2c",
      "allowIdentityChange": false
    },
    {
      "key": "relation:public.reader_content_analysis_call_attempts",
      "beforeSha256": "e308cde7b33a51a37c7872d850ed1b2ebe962898ad8f0ef90772458e8ad1984d",
      "afterSha256": "e308cde7b33a51a37c7872d850ed1b2ebe962898ad8f0ef90772458e8ad1984d",
      "allowIdentityChange": false
    },
    {
      "key": "relation:public.content_analysis_budget",
      "beforeSha256": "3e36aca8c9d041fd89bda2cbf4ad913c67ec0ab3a4ae18f70060a7e5b1cf9092",
      "afterSha256": "3e36aca8c9d041fd89bda2cbf4ad913c67ec0ab3a4ae18f70060a7e5b1cf9092",
      "allowIdentityChange": false
    },
    {
      "key": "relation:public.reader_content_analysis_policies",
      "beforeSha256": "3e36aca8c9d041fd89bda2cbf4ad913c67ec0ab3a4ae18f70060a7e5b1cf9092",
      "afterSha256": "3e36aca8c9d041fd89bda2cbf4ad913c67ec0ab3a4ae18f70060a7e5b1cf9092",
      "allowIdentityChange": false
    },
    {
      "key": "relation:public.reader_collection_policies",
      "beforeSha256": "69b1d6ec70e25a0cb8c51dec9eae19f7e599937c0cf27e37f511bcf679204cd4",
      "afterSha256": "69b1d6ec70e25a0cb8c51dec9eae19f7e599937c0cf27e37f511bcf679204cd4",
      "allowIdentityChange": false
    },
    {
      "key": "relation:public.reader_collection_provider_jobs",
      "beforeSha256": "fce5146d7057b6299bcf140f965cd34e80901273c0b7dac0b5b042ab35a00c3a",
      "afterSha256": "fce5146d7057b6299bcf140f965cd34e80901273c0b7dac0b5b042ab35a00c3a",
      "allowIdentityChange": false
    },
    {
      "key": "relation:public.reader_source_updates",
      "beforeSha256": "e98ed0c02d2d010638e6d9924688bb47178b02d373d97cbef48161129b34cab5",
      "afterSha256": "e98ed0c02d2d010638e6d9924688bb47178b02d373d97cbef48161129b34cab5",
      "allowIdentityChange": false
    },
    {
      "key": "relation:public.reader_workspaces",
      "beforeSha256": "80e94ce0a8e94652995f5b2e29457c72c73da64351c192c1d15c299b6a309483",
      "afterSha256": "80e94ce0a8e94652995f5b2e29457c72c73da64351c192c1d15c299b6a309483",
      "allowIdentityChange": false
    },
    {
      "key": "relation:public.collection_budget_accounts",
      "beforeSha256": "725e6cc83f1441af3e74eb9ea115e11dd31659ee680cc9f3339e8fd71ddc1e38",
      "afterSha256": "725e6cc83f1441af3e74eb9ea115e11dd31659ee680cc9f3339e8fd71ddc1e38",
      "allowIdentityChange": false
    },
    {
      "key": "relation:public.collection_budget_reservations",
      "beforeSha256": "46d0698d1aae6e88f462174bc2a05f523cef8ab988b6f5911202ec4db4f53b3f",
      "afterSha256": "46d0698d1aae6e88f462174bc2a05f523cef8ab988b6f5911202ec4db4f53b3f",
      "allowIdentityChange": false
    },
    {
      "key": "relation:public.collection_provider_fee_receipts",
      "beforeSha256": "996de5d5b8b07d633226b4587e4465ee5c86f729744213a569e8b0671fcd9b00",
      "afterSha256": "996de5d5b8b07d633226b4587e4465ee5c86f729744213a569e8b0671fcd9b00",
      "allowIdentityChange": false
    },
    {
      "key": "relation:public.collection_jobs",
      "beforeSha256": "d6d9242768c21f2846cc87848ec03b93cdb0a30f62752c1d3bc41ee2523df3b4",
      "afterSha256": "d6d9242768c21f2846cc87848ec03b93cdb0a30f62752c1d3bc41ee2523df3b4",
      "allowIdentityChange": false
    },
    {
      "key": "relation:public.automatic_content_policies",
      "beforeSha256": "3e36aca8c9d041fd89bda2cbf4ad913c67ec0ab3a4ae18f70060a7e5b1cf9092",
      "afterSha256": "3e36aca8c9d041fd89bda2cbf4ad913c67ec0ab3a4ae18f70060a7e5b1cf9092",
      "allowIdentityChange": false
    },
    {
      "key": "relation:public.social_content_policies",
      "beforeSha256": "3e36aca8c9d041fd89bda2cbf4ad913c67ec0ab3a4ae18f70060a7e5b1cf9092",
      "afterSha256": "3e36aca8c9d041fd89bda2cbf4ad913c67ec0ab3a4ae18f70060a7e5b1cf9092",
      "allowIdentityChange": false
    },
    {
      "key": "relation:public.social_collection_platforms",
      "beforeSha256": "3e36aca8c9d041fd89bda2cbf4ad913c67ec0ab3a4ae18f70060a7e5b1cf9092",
      "afterSha256": "3e36aca8c9d041fd89bda2cbf4ad913c67ec0ab3a4ae18f70060a7e5b1cf9092",
      "allowIdentityChange": false
    },
    {
      "key": "relation:public.recap_reminder_preferences",
      "beforeSha256": "f2ac4218038ad49a9f8e5c6a310f2d2a720b92c2447f11b3835e083017722984",
      "afterSha256": "f2ac4218038ad49a9f8e5c6a310f2d2a720b92c2447f11b3835e083017722984",
      "allowIdentityChange": false
    },
    {
      "key": "relation:public.recap_reminder_policies",
      "beforeSha256": "f2ac4218038ad49a9f8e5c6a310f2d2a720b92c2447f11b3835e083017722984",
      "afterSha256": "f2ac4218038ad49a9f8e5c6a310f2d2a720b92c2447f11b3835e083017722984",
      "allowIdentityChange": false
    },
    {
      "key": "relation:public.reader_collection_checks",
      "beforeSha256": "784c550118195e4de457449aaaf6891dceae1619dc8bfea887c14ad126b8a28c",
      "afterSha256": "784c550118195e4de457449aaaf6891dceae1619dc8bfea887c14ad126b8a28c",
      "allowIdentityChange": false
    },
    {
      "key": "relation:public.reader_collection_source_state",
      "beforeSha256": "3e36aca8c9d041fd89bda2cbf4ad913c67ec0ab3a4ae18f70060a7e5b1cf9092",
      "afterSha256": "3e36aca8c9d041fd89bda2cbf4ad913c67ec0ab3a4ae18f70060a7e5b1cf9092",
      "allowIdentityChange": false
    },
    {
      "key": "relation:public.hosting_runtime_control",
      "beforeSha256": "5f09fe705b5ee7770516f37032832ceb0427fec9d7f1f64bc8ed6676b726a45e",
      "afterSha256": "5f09fe705b5ee7770516f37032832ceb0427fec9d7f1f64bc8ed6676b726a45e",
      "allowIdentityChange": false
    },
    {
      "key": "relation:public.hosting_work",
      "beforeSha256": "5f09fe705b5ee7770516f37032832ceb0427fec9d7f1f64bc8ed6676b726a45e",
      "afterSha256": "5f09fe705b5ee7770516f37032832ceb0427fec9d7f1f64bc8ed6676b726a45e",
      "allowIdentityChange": false
    },
    {
      "key": "relation:public.hosting_queue_invocations",
      "beforeSha256": "9ae10fde54916ffe060c9600f19520f86f4a4c2904309606461bf5bb00219b67",
      "afterSha256": "9ae10fde54916ffe060c9600f19520f86f4a4c2904309606461bf5bb00219b67",
      "allowIdentityChange": false
    },
    {
      "key": "function:reserve_hourly_provider(uuid,uuid,text,uuid,text,numeric,uuid)",
      "beforeSha256": "181b71b37d63ca9514b4e60a9cfed1979d3827e5f786ee00ffffb29b481e7c4e",
      "afterSha256": "181b71b37d63ca9514b4e60a9cfed1979d3827e5f786ee00ffffb29b481e7c4e",
      "allowIdentityChange": false
    },
    {
      "key": "function:reserve_collection_budget(text,numeric,text,uuid,text,text)",
      "beforeSha256": "fd02225ce20bab408ad4a0a6521fdf93c5a5c17f986cd63efba33ff116faab30",
      "afterSha256": "fd02225ce20bab408ad4a0a6521fdf93c5a5c17f986cd63efba33ff116faab30",
      "allowIdentityChange": false
    },
    {
      "key": "function:settle_collection_budget(uuid,text,numeric,boolean)",
      "beforeSha256": "0429f64571b49832c2292ec5bcee7cabde86b07f9e33577eac708ce320c0dd3c",
      "afterSha256": "0429f64571b49832c2292ec5bcee7cabde86b07f9e33577eac708ce320c0dd3c",
      "allowIdentityChange": false
    },
    {
      "key": "function:record_keyword_learning_call(uuid,text,uuid,uuid,text,jsonb,text)",
      "beforeSha256": "98c7295b6bb9303d5ff89e516a90ae435ac942f3691459287b797b094814371c",
      "afterSha256": "98c7295b6bb9303d5ff89e516a90ae435ac942f3691459287b797b094814371c",
      "allowIdentityChange": false
    },
    {
      "key": "function:read_keyword_learning_call(uuid,text)",
      "beforeSha256": "569c58212539be4a70ec0c3ed083170e53b21ac254b164e0bd95c617926465e2",
      "afterSha256": "569c58212539be4a70ec0c3ed083170e53b21ac254b164e0bd95c617926465e2",
      "allowIdentityChange": false
    },
    {
      "key": "definition:reserve_hourly_provider(uuid,uuid,text,uuid,text,numeric,uuid)",
      "beforeSha256": "529bfdab94f3d54e3bc94f7b0db262beac5f5efd6a07c74cb026f5cdf1035bd6",
      "afterSha256": "529bfdab94f3d54e3bc94f7b0db262beac5f5efd6a07c74cb026f5cdf1035bd6",
      "allowIdentityChange": false
    },
    {
      "key": "definition:reserve_collection_budget(text,numeric,text,uuid,text,text)",
      "beforeSha256": "b739764c69f22d69acfae7894318cc7e2dee2cd49976fa48ebaf6eb154907130",
      "afterSha256": "b739764c69f22d69acfae7894318cc7e2dee2cd49976fa48ebaf6eb154907130",
      "allowIdentityChange": false
    },
    {
      "key": "definition:settle_collection_budget(uuid,text,numeric,boolean)",
      "beforeSha256": "426df636efb5a00fbf07fa5e69099969a2dc46dcd19bfb0e5407665fe1f29d0f",
      "afterSha256": "426df636efb5a00fbf07fa5e69099969a2dc46dcd19bfb0e5407665fe1f29d0f",
      "allowIdentityChange": false
    },
    {
      "key": "definition:read_keyword_learning_call(uuid,text)",
      "beforeSha256": "b77de1be415119ec19eb236b083702fdfcecbdd51a5f00a4723241eea27cb99b",
      "afterSha256": "b77de1be415119ec19eb236b083702fdfcecbdd51a5f00a4723241eea27cb99b",
      "allowIdentityChange": false
    }
  ]
});
