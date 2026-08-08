from pet_detective.narrative_v2 import BehaviourEventV2, merge_events, select_story_events


def event(event_id, start, end, action, confidence=.8, description='event'):
    return BehaviourEventV2(event_id, start, end, action, actor='dog-1', confidence=confidence, description=description)


def test_noise_motion_is_not_selected_for_story():
    selected = select_story_events([
        event('a', 1, 1.2, 'moved_left', .99, 'Dog moved left'),
        event('b', 2, 4, 'petting', .82, 'A person pets the dog'),
    ], session_duration=5)
    assert [item.action for item in selected] == ['petting']


def test_continuous_events_are_merged():
    merged = merge_events([
        event('a', 10, 11, 'petting', .7),
        event('b', 11.4, 12.4, 'petting', .9),
        event('c', 13, 14, 'petting', .8),
    ])
    assert len(merged) == 1
    assert merged[0].start == 10
    assert merged[0].end == 14
    assert merged[0].confidence == .9


def test_story_keeps_temporal_coverage():
    selected = select_story_events([
        event('1', 2, 5, 'resting', .8, 'rests'),
        event('2', 20, 24, 'petting', .85, 'petted'),
        event('3', 51, 52, 'jumping_off', .9, 'jumps down'),
        event('4', 78, 83, 'sniffing', .8, 'sniffs'),
        event('5', 96, 100, 'playing', .88, 'plays'),
    ], session_duration=100, max_events=5)
    starts = [item.start for item in selected]
    assert any(value < 10 for value in starts)
    assert any(45 < value < 60 for value in starts)
    assert any(value > 90 for value in starts)
